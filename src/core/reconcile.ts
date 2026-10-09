import { noteKey } from "./profile";
import { isSecretPath, redactFields } from "../vendor/kit/redact";
import { deepEqual, getAt, isPlainObject, leaves, sameTarget, type Json, type SettingsProfile, type Target } from "./types";
import { CURRENT_STAGE, isWritable, type Stage } from "./write-policy";

export type RowStatus = "change" | "same" | "missing-key" | "not-installed" | "unreadable" | "shape-conflict" | "secret" | "read-only";
export interface CheckRow {
  target: Target; path: string[]; status: RowStatus;
  current?: Json; desired?: Json; note?: string;
  checked: boolean; selectable: boolean;
}
export interface TargetState { target: Target; installed: boolean; text: string | null }

export function parseTarget(text: string | null): { ok: true; content: Json | null } | { ok: false } {
  if (text === null) return { ok: true, content: null };
  try { return { ok: true, content: JSON.parse(text) as Json }; } catch { return { ok: false }; }
}

/** Ein Listen-Wert (Blatt) kann Geheimnisse in seinen Elementen tragen (`endpoints[0].secretId`). */
function hidesSecret(v: Json | undefined): boolean {
  return v !== undefined && redactFields(v).redacted.length > 0;
}

/** Liegt auf dem Weg zu `path` ein vorhandener Wert, der kein Objekt ist? */
function hasShapeConflict(content: Json | null, path: readonly string[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const v = getAt(content, path.slice(0, i));
    if (v !== undefined && !isPlainObject(v)) return true;
  }
  return false;
}

export function reconcile(profile: SettingsProfile, states: readonly TargetState[], stage: Stage = CURRENT_STAGE): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const entry of profile.entries) {
    const target = entry.target;
    const state = states.find((s) => sameTarget(s.target, target)) ?? { target, installed: target.kind === "obsidian", text: null };
    const parsed = parseTarget(state.text);
    const content = parsed.ok ? parsed.content : null;
    for (const { path, value } of leaves(entry.values)) {
      const note = profile.notes[noteKey(target, path)];
      const base = { target, path, ...(note !== undefined ? { note } : {}) };
      const no = { checked: false, selectable: false };
      const currentRaw = getAt(content, path);
      if (isSecretPath(content, path) || isSecretPath(entry.values, path) || hidesSecret(currentRaw) || hidesSecret(value)) { rows.push({ target, path, status: "secret", ...no }); continue; }
      if (!state.installed) { rows.push({ ...base, status: "not-installed", desired: value, ...no }); continue; }
      if (!parsed.ok) { rows.push({ ...base, status: "unreadable", desired: value, ...no }); continue; }
      const current = currentRaw;
      if (!isWritable(target, stage)) { rows.push({ ...base, status: "read-only", ...(current !== undefined ? { current } : {}), desired: value, ...no }); continue; }
      if (hasShapeConflict(content, path)) { rows.push({ ...base, status: "shape-conflict", desired: value, ...no }); continue; }
      if (current === undefined) { rows.push({ ...base, status: "missing-key", desired: value, checked: false, selectable: true }); continue; }
      if (deepEqual(current, value)) { rows.push({ ...base, status: "same", current, desired: value, ...no }); continue; }
      rows.push({ ...base, status: "change", current, desired: value, checked: true, selectable: true });
    }
  }
  return rows;
}
