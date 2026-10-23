import type { App } from "obsidian";
import type { ApplyReport, RowOutcome } from "../core/apply-run";
import { isValidPluginId, parseProfile } from "../core/profile";
import type { CheckRow, RowStatus } from "../core/reconcile";
import { parseTarget } from "../core/reconcile";
import { redactFields } from "../vendor/kit/redact";
import { OBSIDIAN_FILES, isPlainObject, targetKey, type Json, type ObsidianFile, type SettingsProfile } from "../core/types";
import { CURRENT_STAGE, isSelfPluginId, isWritable, targetPath } from "../core/write-policy";
import type { ProviderCallOptions, ProviderConfirmPreview, ProviderResult, ToolLang } from "../vendor/kit/tool-provider";
import { readConfig } from "./config-io";
import { isInstalled } from "./plugin-host";
import { snapshotRoot } from "./snapshots";

/** Typen für Konsumenten: kopieren, nicht importieren (docs/API.md). */
export interface ApiCheckRow { target: string; path: string; status: RowStatus; current?: Json; desired?: Json; note?: string }
export interface ApiToolDefinition { name: string; description: string; parameters: object; writes: boolean; confirms: "provider" | "caller" }
export interface ApiApplyResult { results: Array<{ path: string; outcome: RowOutcome; actual?: Json }>; snapshot: string | null }
export type ApiError = { error: string };

export interface SettingsAssistantApi {
  apiVersion: 1;
  /** Vertrag aus der Bibliothek (Kit `tool-provider`, `TOOL_PROVIDER_API_VERSION`); `apiVersion` bleibt der eigene Vertrag des Plugins. */
  version: 1;
  status(): { busy: boolean; writable: string[]; stage: "v1" };
  readSettings(q: { plugin: string } | { file: ObsidianFile }): Promise<{ settings: Json | null; redacted: string[] } | ApiError>;
  planProfile(profile: unknown): Promise<{ rows: ApiCheckRow[] } | ApiError>;
  applyProfile(profile: unknown, opts: { origin: string }): Promise<ApiApplyResult | { cancelled: true } | { busy: true } | ApiError>;
  /** Beide Verträge teilen die Liste: `writes` und `confirms` (eigener Vertrag), `name`/`description`/`parameters`/`writes` (Bibliothek). */
  tools(opts?: { lang?: ToolLang }): ApiToolDefinition[];
  execute(name: string, args: unknown): Promise<unknown>;
  /** Werkzeugvertrag der Bibliothek: ein Schritt, Fehler sind Werte. Schreibend nur nach `opts.confirm` UND dem eigenen Diff-Dialog. */
  executeTool(name: string, args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult>;
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
  // Die eigenen Einstellungen liest die API nie (readSettings → own-settings); der Plan zeigt sie deshalb ohne Werte.
  if (r.target.kind === "plugin" && isSelfPluginId(r.target.id)) return { target, path, status: "read-only" };
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
      ...(r.actual !== undefined && r.row.status !== "secret" ? { actual: redactFields(r.actual).value } : {}),
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
      const r = redactFields(parsed.content);
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

  // --- Werkzeugvertrag der Bibliothek (Kit `tool-provider`) -------------------------------------------------------------------------------------
  // Die Sprache nennt der Wirt, den Text liefert das Plugin (Festlegung (b) des Vertrags); ohne Angabe Englisch wie die Werkzeugbeschreibungen.
  const say = (opts: ProviderCallOptions | undefined, en: string, de: string): string => (opts?.lang === "de" ? de : en);
  const failed = (message: string): ProviderResult => ({ ok: false, reason: "failed", message });
  const badArgs = (field: string, message: string): ProviderResult => ({ ok: false, reason: "bad-args", field, message });
  const needsConfirm = (message: string): ProviderResult => ({ ok: false, reason: "needs-confirm", message });

  async function readTool(args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const r = await readSettings(args);
    if ("error" in r) {
      switch (r.error) {
        case "bad-args": return badArgs("plugin", say(opts, "Give exactly one of `plugin` (a plugin id) or `file` (an Obsidian config file).", "Genau eines von `plugin` (Plugin-ID) oder `file` (Obsidian-Konfigurationsdatei) angeben."));
        case "own-settings": return failed(say(opts, "The settings of Settings Assistant itself are not readable through the tools.", "Die Einstellungen von Settings Assistant selbst sind über die Werkzeuge nicht lesbar."));
        case "not-installed": return failed(say(opts, "That plugin is not installed.", "Dieses Plugin ist nicht installiert."));
        case "unreadable": return failed(say(opts, "The settings file could not be read.", "Die Einstellungsdatei ließ sich nicht lesen."));
        default: return failed(say(opts, "Reading the settings failed.", "Das Lesen der Einstellungen ist fehlgeschlagen."));
      }
    }
    return { ok: true, content: JSON.stringify(r), data: r };
  }

  async function proposeTool(args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult> {
    if (!("profile" in args)) return badArgs("profile", say(opts, "`profile` is required.", "`profile` ist erforderlich."));
    const p = toProfile(args.profile);
    if (!("ok" in p)) return badArgs("profile", say(opts, `The profile is not valid (${p.error}).`, `Das Profil ist ungültig (${p.error}).`));
    if (service.busy) return { ok: false, reason: "unavailable", detail: "busy", message: say(opts, "Settings Assistant is busy with another run.", "Settings Assistant ist mit einem anderen Lauf beschäftigt.") };
    const confirm = opts?.confirm;
    if (typeof confirm !== "function") return needsConfirm(say(opts, "Nothing was written: this tool needs the host to confirm first.", "Nichts geschrieben: dieses Werkzeug braucht zuerst die Bestätigung des Wirts."));

    // Nebenwirkungsfreie Vorschau: nur Zielnamen und Pfade, nie Werte (Geheimnisse bleiben so draußen).
    const writable = (await service.plan(p.profile)).filter((row) => row.selectable);
    if (writable.length === 0) return { ok: true, content: say(opts, "Nothing to change: every setting in the profile already has the proposed value or cannot be written.", "Nichts zu ändern: jede Einstellung im Profil hat schon den vorgeschlagenen Wert oder ist nicht schreibbar."), data: { results: [], snapshot: null } };
    const targets = [...new Set(writable.map((row) => targetKey(row.target)))];
    const paths = [...new Set(writable.map((row) => targetPath(row.target, app.vault.configDir)))];
    const preview: ProviderConfirmPreview = {
      // Obergrenze der berührten Pfade: die Zieldateien und der Ordner des Schnappschusses, der vor dem ersten Schreiben angelegt wird.
      paths: [...paths, snapshotRoot(app)],
      summary: say(
        opts,
        `Change ${writable.length} ${writable.length === 1 ? "setting" : "settings"} in ${targets.join(", ")}. Settings Assistant then shows its own diff dialog; nothing is written unless the user confirms there.`,
        `${writable.length} ${writable.length === 1 ? "Einstellung" : "Einstellungen"} in ${targets.join(", ")} ändern. Settings Assistant zeigt danach seinen eigenen Diff-Dialog; ohne Bestätigung dort wird nichts geschrieben.`,
      ),
    };
    let granted = false;
    try { granted = (await confirm(preview)) === true; } catch { granted = false; }
    if (!granted) return needsConfirm(say(opts, "Nothing was written: the host did not confirm.", "Nichts geschrieben: der Wirt hat nicht bestätigt."));

    // Es gibt keinen Parameter, der den eigenen Dialog überspringt: die Bestätigung des Wirts ersetzt ihn nicht.
    const r = await service.applyInteractive(p.profile, sanitizeOrigin("propose_settings"));
    if ("cancelled" in r) return needsConfirm(say(opts, "Nothing was written: the user declined in Settings Assistant's own diff dialog.", "Nichts geschrieben: der Nutzer hat im eigenen Diff-Dialog von Settings Assistant abgelehnt."));
    if ("busy" in r) return { ok: false, reason: "unavailable", detail: "busy", message: say(opts, "Settings Assistant is busy with another run.", "Settings Assistant ist mit einem anderen Lauf beschäftigt.") };
    if ("error" in r) return failed(say(opts, "Applying the profile failed.", "Das Anwenden des Profils ist fehlgeschlagen.")); // der Meldungstext des Dienstes bleibt im Plugin
    const result = toApiResult(r);
    const lines = result.results.map((x) => `${x.path} — ${x.outcome}`);
    return { ok: true, content: lines.join("\n"), data: result };
  }

  async function executeTool(name: string, args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult> {
    try {
      if (name !== "read_settings" && name !== "propose_settings") return { ok: false, reason: "unknown-tool", message: say(opts, `Unknown tool: ${name}`, `Unbekanntes Werkzeug: ${name}`) };
      if (!isPlainObject(args)) return badArgs("args", say(opts, "The arguments must be an object.", "Die Argumente müssen ein Objekt sein."));
      return name === "read_settings" ? await readTool(args, opts) : await proposeTool(args, opts);
    } catch { return failed(say(opts, "The tool failed.", "Das Werkzeug ist fehlgeschlagen.")); }
  }

  return { apiVersion: 1, version: 1, status, readSettings, planProfile, applyProfile, tools, execute, executeTool };
}
