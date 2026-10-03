// src/core/types.ts
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObsidianFile = "hotkeys" | "app" | "appearance" | "core-plugins" | "community-plugins";
export const OBSIDIAN_FILES: readonly ObsidianFile[] = ["hotkeys", "app", "appearance", "core-plugins", "community-plugins"];
export type Target = { kind: "plugin"; id: string } | { kind: "obsidian"; file: ObsidianFile };
export interface ProfileEntry { target: Target; values: Json }
export interface SettingsProfile {
  version: 1;
  entries: ProfileEntry[];
  /** Je Pfad `<targetKey>.<schlüssel…>` ein Satz „warum“ (Spec § 6). */
  notes: Record<string, string>;
  /** Abschnitte, die diese Fassung nicht kennt — angezeigt, nicht still verworfen. */
  unknownSections: string[];
}

export function isPlainObject(v: unknown): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export function getAt(root: Json | null, path: readonly string[]): Json | undefined {
  let cur: Json | undefined = root ?? undefined;
  for (const seg of path) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

export function leaves(values: Json, prefix: string[] = []): Array<{ path: string[]; value: Json }> {
  if (!isPlainObject(values) || (prefix.length > 0 && Object.keys(values).length === 0)) {
    return [{ path: prefix, value: values }];
  }
  return Object.entries(values).flatMap(([k, v]) =>
    isPlainObject(v) && Object.keys(v).length > 0 ? leaves(v, [...prefix, k]) : [{ path: [...prefix, k], value: v }],
  );
}

export function sameTarget(a: Target, b: Target): boolean {
  if (a.kind === "plugin" && b.kind === "plugin") return a.id === b.id;
  if (a.kind === "obsidian" && b.kind === "obsidian") return a.file === b.file;
  return false;
}

export function targetKey(t: Target): string {
  return t.kind === "plugin" ? `plugins.${t.id}` : t.file;
}
