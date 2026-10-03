/** Einzige Stelle, die `settings-profile`-Zäune erkennt — für das Herausziehen (chat-context) UND das Entfernen aus dem
 *  gerenderten Chat-Text. Zwei getrennte Regexe liefen auseinander (I3: Leerzeichen vor dem Tag fiel durch beide).
 *  Großzügig wie CommonMark und etwas darüber: beliebiger Einzug, ``` oder ~~~ beliebiger Länge, Leerraum vor dem Tag,
 *  Tag ohne Rücksicht auf Groß/Klein, beliebiger Rest des Info-Strings. Geschlossen wird mit demselben Zeichen in
 *  mindestens derselben Länge; ein Zaun ohne Schluss reicht bis zum Textende. */

const OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*settings-profile(?=[ \t]|$)/i;

export interface ProfileFence {
  /** Erste Zeile (Öffner), Index in `text.split("\n")`. */
  start: number;
  /** Erste Zeile NACH dem Block (nach dem Schließer bzw. Zeilenanzahl). */
  end: number;
  body: string;
  closed: boolean;
}

function isCloser(line: string, char: string, len: number): boolean {
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === char && m[1].length >= len;
}

export function findProfileFences(text: string): ProfileFence[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: ProfileFence[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = OPEN.exec(lines[i]);
    if (m === null) { i++; continue; }
    const char = m[1][0]; const len = m[1].length;
    let j = i + 1;
    while (j < lines.length && !isCloser(lines[j], char, len)) j++;
    const closed = j < lines.length;
    out.push({ start: i, end: closed ? j + 1 : lines.length, body: lines.slice(i + 1, j).join("\n"), closed });
    i = closed ? j + 1 : lines.length;
  }
  return out;
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
