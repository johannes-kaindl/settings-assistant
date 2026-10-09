import { redactFields } from "../vendor/kit/redact";
import { noteKey, serializeProfile, type ParseResult } from "./profile";
import { targetKey, type Json, type SettingsProfile } from "./types";

/** Zaun länger als jede Backtick-Folge im Inhalt, mindestens drei. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** Schwärzt geheime Werte im Profil, bevor es als Notiz gespeichert wird. Notizen zu betroffenen Zielen entfallen
 *  (Freitext könnte den Wert wiederholen). `redacted` nennt nur Pfade, nie Werte. */
export function redactedProfileNote(profile: SettingsProfile): { text: string; redacted: string[] } {
  const { text: body, redacted } = redactedProfileJson(profile);
  const fence = fenceFor(body);
  return { text: [`${fence}settings-profile`, body, fence, ""].join("\n"), redacted };
}

/** Das geschwärzte Profil als JSON-Text (ohne Zaun) — Grundlage für Notiz und Roh-Anzeige im Chat. */
export function redactedProfileJson(profile: SettingsProfile): { text: string; redacted: string[] } {
  const redacted: string[] = [];
  const hit = new Set<string>();
  const entries = profile.entries.map((e) => {
    const r = redactFields(e.values);
    if (r.redacted.length > 0) {
      hit.add(targetKey(e.target));
      for (const p of r.redacted) redacted.push(`${targetKey(e.target)}.${p}`);
    }
    return { ...e, values: r.value };
  });
  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(profile.notes)) {
    const dropped = profile.entries.some((e) => { const tk = noteKey(e.target, []); return hit.has(targetKey(e.target)) && (k === tk || k.startsWith(`${tk}.`)); });
    if (!dropped) notes[k] = v;
  }
  return { text: serializeProfile({ ...profile, entries, notes }), redacted };
}

/** Roh-Anzeige eines Chat-Blocks (Spec § 8): gültiges Profil geschwärzt; gültiges JSON ohne gültiges Profil ebenfalls
 *  geschwärzt; kein JSON → `null` (der Rohtext könnte ein Geheimnis tragen und wird nie gezeigt). */
export function redactedRawBlock(raw: string, result: ParseResult): string | null {
  if (result.ok) return redactedProfileJson(result.profile).text;
  let parsed: Json;
  try { parsed = JSON.parse(raw) as Json; } catch { return null; }
  return JSON.stringify(redactFields(parsed).value, null, 2);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `Settings profile YYYY-MM-DD HH-mm` (Ortszeit), ohne Endung. */
export function profileNoteName(d: Date): string {
  return `Settings profile ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
