import { isPlainObject, type SettingsProfile } from "./types";
import { isValidPluginId } from "./profile";
import { isSelfPluginId } from "./write-policy";
import type { Json } from "./types";

/** Warum aus dem Ist-Stand eines Plugins kein Profil wird. Nie der Text der Datei und nie eine `JSON.parse`-Meldung (V8 hängt dem Fehler den Quelltext an, und der kann ein Geheimnis tragen). */
export type ExportRefusal = "self" | "bad-id" | "no-file" | "unreadable" | "not-object" | "empty";
export type ExportResult = { ok: true; profile: SettingsProfile } | { ok: false; reason: ExportRefusal };

/** Der Ist-Stand eines Plugins (der Text seiner `data.json`, `null` = die Datei fehlt) als Profil mit einem Eintrag, ohne Modell. Das Schwärzen der Geheimnisse
 *  geschieht erst beim Ablegen (`redactedProfileNote`, derselbe Weg wie „Als Profilnotiz speichern“ im Chat): hier steht der Wert noch im Profil. Das eigene Plugin wird nie
 *  exportiert (seine Einstellungen laufen nie über ein Profil). */
export function profileFromState(id: string, text: string | null): ExportResult {
  if (isSelfPluginId(id)) return { ok: false, reason: "self" };
  if (!isValidPluginId(id)) return { ok: false, reason: "bad-id" };
  if (text === null) return { ok: false, reason: "no-file" };
  let parsed: Json;
  try { parsed = JSON.parse(text) as Json; } catch { return { ok: false, reason: "unreadable" }; }
  if (!isPlainObject(parsed)) return { ok: false, reason: "not-object" };
  if (Object.keys(parsed).length === 0) return { ok: false, reason: "empty" };
  return { ok: true, profile: { version: 1, entries: [{ target: { kind: "plugin", id }, values: parsed }], notes: {}, unknownSections: [] } };
}
