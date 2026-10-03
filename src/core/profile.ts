// src/core/profile.ts
import { OBSIDIAN_FILES, isPlainObject, targetKey, type Json, type ObsidianFile, type ProfileEntry, type SettingsProfile, type Target } from "./types";

export const PROFILE_VERSION = 1;
/** Obsidian-Plugin-IDs: Buchstaben, Ziffern, `-`, `_`, `.`; kein führender Punkt, kein `..`, kein `/`. */
export const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Einzige Stelle für die Plugin-ID-Prüfung (Muster plus kein `..`). */
export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_RE.test(id) && !id.includes("..");
}

/**
 * ACHTUNG `detail`: rohe JSON.parse-Meldung. V8 hängt bei "Unexpected token" den Quelltext an,
 * der ein Geheimnis enthalten kann. Sie darf NIE in UI, Notice, Log, Chat-Kontext oder API
 * ausgegeben werden; Konsumenten zeigen nur `code`.
 */
export type ProfileError =
  | { code: "invalid-json"; detail: string }
  | { code: "not-object" }
  | { code: "missing-version" }
  | { code: "bad-version"; version: unknown }
  | { code: "future-version"; version: number }
  | { code: "bad-section"; section: string; reason: "not-object" | "bad-id" };
export type ParseResult = { ok: true; profile: SettingsProfile } | { ok: false; error: ProfileError };

const OBJECT_FILES: readonly ObsidianFile[] = ["hotkeys", "app", "appearance"];
const fail = (error: ProfileError): ParseResult => ({ ok: false, error });

export function parseProfile(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) {
    return fail({ code: "invalid-json", detail: e instanceof Error ? e.message : String(e) });
  }
  if (!isPlainObject(raw)) return fail({ code: "not-object" });
  if (!("version" in raw)) return fail({ code: "missing-version" });
  const v = raw.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return fail({ code: "bad-version", version: v });
  if (v > PROFILE_VERSION) return fail({ code: "future-version", version: v });

  const entries: ProfileEntry[] = [];
  const notes: Record<string, string> = {};
  const unknownSections: string[] = [];
  for (const [key, val] of Object.entries(raw)) {
    if (key === "version") continue;
    if (key === "notes") {
      if (!isPlainObject(val)) return fail({ code: "bad-section", section: "notes", reason: "not-object" });
      for (const [nk, nv] of Object.entries(val)) if (typeof nv === "string") notes[nk] = nv;
      continue;
    }
    if (key === "plugins") {
      if (!isPlainObject(val)) return fail({ code: "bad-section", section: "plugins", reason: "not-object" });
      for (const [id, values] of Object.entries(val)) {
        if (!isValidPluginId(id)) return fail({ code: "bad-section", section: `plugins.${id}`, reason: "bad-id" });
        if (!isPlainObject(values)) return fail({ code: "bad-section", section: `plugins.${id}`, reason: "not-object" });
        entries.push({ target: { kind: "plugin", id }, values });
      }
      continue;
    }
    const file = OBSIDIAN_FILES.find((f) => f === key);
    if (file) {
      if (OBJECT_FILES.includes(file) && !isPlainObject(val)) return fail({ code: "bad-section", section: key, reason: "not-object" });
      entries.push({ target: { kind: "obsidian", file }, values: val });
      continue;
    }
    unknownSections.push(key);
  }
  return { ok: true, profile: { version: 1, entries, notes, unknownSections } };
}

export function serializeProfile(p: SettingsProfile): string {
  const out: { [k: string]: Json } = { version: p.version };
  const plugins: { [k: string]: Json } = {};
  for (const e of p.entries) if (e.target.kind === "plugin") plugins[e.target.id] = e.values;
  if (Object.keys(plugins).length > 0) out.plugins = plugins;
  // Obsidian-Dateien NACH plugins, damit parse(serialize(p)) dieselbe entries-Reihenfolge ergibt.
  for (const e of p.entries) if (e.target.kind === "obsidian") out[e.target.file] = e.values;
  if (Object.keys(p.notes).length > 0) out.notes = p.notes;
  return JSON.stringify(out, null, 2);
}

export function noteKey(t: Target, path: readonly string[]): string {
  return [targetKey(t), ...path].join(".");
}
