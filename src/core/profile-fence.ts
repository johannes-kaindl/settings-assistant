/** Einzige Stelle, die `settings-profile`-Zäune erkennt — für das Herausziehen (chat-context) UND das Entfernen aus dem
 *  gerenderten Chat-Text. Der Zaun-Scanner ist `listFences` aus code-kit (`fences`, seit 0.71.0), mit `maxIndent: Infinity`
 *  (beliebiger Einzug, großzügiger als CommonMark) und einem Filter auf `lang === "settings-profile"` (Groß/Klein egal, das
 *  Kit senkt das Wort). Geschlossen wird mit demselben Zeichen in mindestens derselben Länge; ein Zaun ohne Schluss reicht
 *  bis zum Textende. Zwei Abweichungen von der früheren Eigenfassung sind gewollt, weil ein Modell-Antworttext CommonMark-genau
 *  gerendert wird (`tests/profile-fence.test.ts`, Gruppe „Abweichungen vom Kit“): (1) ein Info-String mit Backtick nach dem
 *  Tag („```settings-profile x`“) ist kein Zaun, (2) ein anderer Zaun davor verschluckt einen späteren `settings-profile`-Öffner
 *  (er steht dann im Inhalt des anderen Zauns), (3) bei einem Tilde-Zaun darf der Info-String einen Backtick tragen, (4) ein einzelnes `\r` am Textende bleibt im Inhalt eines offenen Zauns. */
import { listFences } from "../vendor/kit/fences";

const LANG = "settings-profile";

export interface ProfileFence {
  /** Erste Zeile (Öffner), Index in `text.split("\n")`. */
  start: number;
  /** Erste Zeile NACH dem Block (nach dem Schließer bzw. Zeilenanzahl). */
  end: number;
  body: string;
  closed: boolean;
}

export function findProfileFences(text: string): ProfileFence[] {
  return listFences(text, { maxIndent: Infinity })
    .filter((f) => f.lang === LANG)
    .map((f) => ({ start: f.openLine, end: f.closeLine + 1, body: f.body, closed: f.closed }));
}

/** Entfernt Profilblöcke (auch unvollständige) aus dem Text, damit der Codeblock-Prozessor sie nicht ein zweites Mal rendert. */
export function stripProfileBlocks(text: string): string {
  const fences = findProfileFences(text);
  if (fences.length === 0) return text.trim();
  const lines = text.split("\n");
  const drop = new Set<number>();
  for (const f of fences) for (let k = f.start; k < f.end; k++) drop.add(k);
  return lines.filter((_l, k) => !drop.has(k)).join("\n").trim();
}
