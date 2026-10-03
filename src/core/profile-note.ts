import { redact } from "./secrets";
import { noteKey, serializeProfile } from "./profile";
import { targetKey, type SettingsProfile } from "./types";

/** Zaun länger als jede Backtick-Folge im Inhalt, mindestens drei. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** Schwärzt geheime Werte im Profil, bevor es als Notiz gespeichert wird. Notizen zu betroffenen Zielen entfallen
 *  (Freitext könnte den Wert wiederholen). `redacted` nennt nur Pfade, nie Werte. */
export function redactedProfileNote(profile: SettingsProfile): { text: string; redacted: string[] } {
  const redacted: string[] = [];
  const hit = new Set<string>();
  const entries = profile.entries.map((e) => {
    const r = redact(e.values);
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
  const body = serializeProfile({ ...profile, entries, notes });
  const fence = fenceFor(body);
  return { text: [`${fence}settings-profile`, body, fence, ""].join("\n"), redacted };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `Settings profile YYYY-MM-DD HH-mm` (Ortszeit), ohne Endung. */
export function profileNoteName(d: Date): string {
  return `Settings profile ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
