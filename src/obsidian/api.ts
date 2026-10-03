import type { App } from "obsidian";
import type { ApplyReport, RowOutcome } from "../core/apply-run";
import { isValidPluginId, parseProfile } from "../core/profile";
import type { CheckRow, RowStatus } from "../core/reconcile";
import { parseTarget } from "../core/reconcile";
import { redact } from "../core/secrets";
import { OBSIDIAN_FILES, isPlainObject, targetKey, type Json, type ObsidianFile, type SettingsProfile } from "../core/types";
import { CURRENT_STAGE, isSelfPluginId, isWritable, targetPath } from "../core/write-policy";
import { readConfig } from "./config-io";
import { isInstalled } from "./plugin-host";

/** Typen für Konsumenten: kopieren, nicht importieren (docs/API.md). */
export interface ApiCheckRow { target: string; path: string; status: RowStatus; current?: Json; desired?: Json; note?: string }
export interface ApiToolDefinition { name: string; description: string; parameters: object; writes: boolean; confirms: "provider" | "caller" }
export interface ApiApplyResult { results: Array<{ path: string; outcome: RowOutcome; actual?: Json }>; snapshot: string | null }
export type ApiError = { error: string };

export interface SettingsAssistantApi {
  apiVersion: 1;
  status(): { busy: boolean; writable: string[]; stage: "v1" };
  readSettings(q: { plugin: string } | { file: ObsidianFile }): Promise<{ settings: Json | null; redacted: string[] } | ApiError>;
  planProfile(profile: unknown): Promise<{ rows: ApiCheckRow[] } | ApiError>;
  applyProfile(profile: unknown, opts: { origin: string }): Promise<ApiApplyResult | { cancelled: true } | { busy: true } | ApiError>;
  tools(): ApiToolDefinition[];
  execute(name: string, args: unknown): Promise<unknown>;
}

/** Der Teil des ApplyService, den die API braucht. `applyInteractive` öffnet immer den eigenen Dialog. */
export interface ApplyApiService {
  readonly busy: boolean;
  plan(profile: SettingsProfile): Promise<CheckRow[]>;
  applyInteractive(profile: SettingsProfile, origin: string): Promise<ApplyReport | { cancelled: true } | { busy: true } | { error: string }>;
}

const FAILED: ApiError = { error: "failed" };
const BAD_ARGS: ApiError = { error: "bad-args" };
const ORIGIN_MAX = 80;
// Steuer- und Formatzeichen (u. a. Zeilenumbrüche, U+2028/2029) sind im Herkunftsnamen nicht erlaubt.
const ORIGIN_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function sanitizeOrigin(origin: unknown): string {
  if (typeof origin !== "string" || origin.trim() === "" || origin.length > ORIGIN_MAX || ORIGIN_FORBIDDEN.test(origin)) return "api:unknown";
  return `api:${origin}`;
}

/** Profil als Objekt oder JSON-Text; nur der Fehlercode verlässt das Plugin, nie `detail`. */
function toProfile(input: unknown): { ok: true; profile: SettingsProfile } | ApiError {
  let text: string;
  if (typeof input === "string") text = input;
  else {
    try { text = JSON.stringify(input); } catch { return { error: "invalid-profile" }; }
    if (typeof text !== "string") return { error: "invalid-profile" };
  }
  const r = parseProfile(text);
  return r.ok ? r : { error: r.error.code };
}

function toApiRow(r: CheckRow): ApiCheckRow {
  const target = targetKey(r.target);
  const path = r.path.join(".");
  // 🔒-Zeilen tragen nur Schlüsselname und Status — weder Wert noch Notiz.
  if (r.status === "secret") return { target, path, status: "secret" };
  return {
    target, path, status: r.status,
    ...(r.current !== undefined ? { current: r.current } : {}),
    ...(r.desired !== undefined ? { desired: r.desired } : {}),
    ...(r.note !== undefined ? { note: r.note } : {}),
  };
}

function toApiResult(report: ApplyReport): ApiApplyResult {
  return {
    snapshot: report.snapshotDir,
    results: report.results.map((r) => ({
      path: `${targetKey(r.row.target)}.${r.row.path.join(".")}`,
      outcome: r.outcome,
      ...(r.actual !== undefined && r.row.status !== "secret" ? { actual: redact(r.actual).value } : {}),
    })),
  };
}

const FILE_PARAM = { type: "string", enum: [...OBSIDIAN_FILES], description: "Obsidian config file (secrets are redacted)" };

export function createSettingsAssistantApi(deps: { app: App; service: ApplyApiService }): SettingsAssistantApi {
  const { app, service } = deps;

  const status = (): ReturnType<SettingsAssistantApi["status"]> => ({
    busy: service.busy,
    writable: ["plugins/*/data.json", ...OBSIDIAN_FILES.filter((file) => isWritable({ kind: "obsidian", file }, CURRENT_STAGE))],
    stage: "v1",
  });

  async function readSettings(q: unknown): Promise<{ settings: Json | null; redacted: string[] } | ApiError> {
    try {
      if (!isPlainObject(q)) return BAD_ARGS;
      const rec = q as Record<string, unknown>;
      const hasPlugin = rec.plugin !== undefined;
      const hasFile = rec.file !== undefined;
      if (hasPlugin === hasFile) return BAD_ARGS;
      let path: string;
      if (hasPlugin) {
        if (typeof rec.plugin !== "string" || !isValidPluginId(rec.plugin)) return BAD_ARGS;
        if (isSelfPluginId(rec.plugin)) return { error: "own-settings" };
        if (!isInstalled(app, rec.plugin)) return { error: "not-installed" };
        path = targetPath({ kind: "plugin", id: rec.plugin }, app.vault.configDir);
      } else {
        const file = OBSIDIAN_FILES.find((f) => f === rec.file);
        if (file === undefined) return BAD_ARGS;
        path = targetPath({ kind: "obsidian", file }, app.vault.configDir);
      }
      const parsed = parseTarget(await readConfig(app, path));
      if (!parsed.ok) return { error: "unreadable" };
      if (parsed.content === null) return { settings: null, redacted: [] };
      const r = redact(parsed.content);
      return { settings: r.value, redacted: r.redacted };
    } catch { return FAILED; }
  }

  async function planProfile(input: unknown): Promise<{ rows: ApiCheckRow[] } | ApiError> {
    try {
      const p = toProfile(input);
      if (!("ok" in p)) return p;
      return { rows: (await service.plan(p.profile)).map(toApiRow) };
    } catch { return FAILED; }
  }

  async function applyProfile(input: unknown, opts: { origin: string }): Promise<ApiApplyResult | { cancelled: true } | { busy: true } | ApiError> {
    try {
      const p = toProfile(input);
      if (!("ok" in p)) return p;
      if (service.busy) return { busy: true };
      // Es gibt keinen Parameter, der die Bestätigung überspringt: der Dienst öffnet immer seinen eigenen Dialog.
      const r = await service.applyInteractive(p.profile, sanitizeOrigin(isPlainObject(opts) ? opts.origin : undefined));
      if ("cancelled" in r || "busy" in r) return r;
      if ("error" in r) return FAILED; // der Meldungstext des Dienstes bleibt im Plugin
      return toApiResult(r);
    } catch { return FAILED; }
  }

  const tools = (): ApiToolDefinition[] => [
    {
      name: "read_settings",
      description: "Read the current settings of one installed plugin or one Obsidian config file. Secret values are always redacted.",
      parameters: { type: "object", properties: { plugin: { type: "string", description: "Plugin id" }, file: FILE_PARAM }, additionalProperties: false },
      writes: false, confirms: "caller",
    },
    {
      name: "propose_settings",
      description: "Propose a settings profile. Settings Assistant shows its own diff dialog; nothing is written unless the user confirms there.",
      parameters: { type: "object", properties: { profile: { type: "object", description: "Profile: { version: 1, plugins?: { <id>: {…} }, hotkeys?: {…}, notes?: { <path>: <reason> } }" } }, required: ["profile"], additionalProperties: false },
      writes: true, confirms: "provider",
    },
  ];

  async function execute(name: string, args: unknown): Promise<unknown> {
    try {
      if (name !== "read_settings" && name !== "propose_settings") return { error: "unknown-tool" };
      if (typeof args !== "object" || args === null || Array.isArray(args)) return BAD_ARGS;
      const a = args as Record<string, unknown>;
      if (name === "read_settings") return await readSettings(a);
      if (!("profile" in a)) return BAD_ARGS;
      return await applyProfile(a.profile, { origin: "propose_settings" });
    } catch { return FAILED; }
  }

  return { apiVersion: 1, status, readSettings, planProfile, applyProfile, tools, execute };
}
