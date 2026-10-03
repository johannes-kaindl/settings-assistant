/**
 * Neutralisiert Markdown aus nicht vertrauenswürdiger Quelle (LLM-Antwort) VOR `MarkdownRenderer.render`.
 * Rein, ohne Abhängigkeiten — gedacht als hebbares Modul (Kit-Kandidat `safe-markdown`).
 *
 * Bedrohungsmodell: Der Renderer führt alles aus, was im Vault registriert ist, nicht nur Obsidians Kern.
 * - Fremde Codeblock-Prozessoren: ein Zaun mit Sprach-Tag (```` ```dataviewjs ````, `dataview`, `tasks`, …) startet den
 *   Prozessor des jeweiligen Plugins. Bei Dataview-JS ist das Ausführung beliebigen Codes im Renderer.
 *   → Jede Zeile, die nach Einzug/Zitat-/Listenpräfix mit ≥3 Backticks oder Tilden beginnt UND einen nicht leeren
 *   Info-String trägt, bekommt den Info-String `text`. Zeilen nur aus Zaunzeichen und Leerraum bleiben, damit
 *   Schließzäune Schließzäune bleiben. Ein Schließer mit Info-String ist in CommonMark kein Schließer; er bleibt nach
 *   dem Umschreiben (`text`) ebenfalls keiner — die Parse-Struktur ändert sich also nicht. Ausnahme: ein Backtick-
 *   „Zaun“ mit Backtick im Info-String ist in CommonMark Inline-Code und wird hier zum Öffner — das macht den Rest
 *   zum Codeblock, also inerter, nie aktiver.
 * - Inline-Abfragen (Dataview `= …` und `$= …`): Inline-Code, dessen Inhalt mit `=` beginnt oder `$=` enthält, wird
 *   aufgelöst: Backticks escaped, Inhalt mit Backslash-Escapes als Literaltext. Er bleibt sichtbar, ist aber kein
 *   `<code>`-Element mehr.
 * - Remote-Bilder und Embeds: `![…](url)`, `![…][ref]`, `![[…]]` laden von selbst → werden Text bzw. Code.
 * - HTML: jedes `<` wird `&lt;` (kein `<img>`, `<iframe>`, `<script>`, …).
 * Bewusst OHNE Fence-Zustand: jede Abweichung von der Erkennung des Renderers ließe etwas ungeprüft durch; der Text
 * wird zeilenweise einheitlich umgeschrieben, auch innerhalb von Codeblöcken (dort sieht man ggf. Escapes).
 * Links bleiben (ein Klick ist eine Nutzerhandlung).
 *
 * Restrisiko: (1) Inline-Abfragen mit einem vom Nutzer umkonfigurierten Präfix (Dataview-Einstellung) und andere
 * Plugins, die beliebigen Inline-Code deuten, werden nicht erkannt. (2) Post-Prozessoren, die gewöhnlichen Text oder
 * Links verarbeiten (Link-Vorschau, Karten), laufen weiter — eine zweite Linie nach dem Rendern bleibt nötig.
 * (3) Ein Prozessor, der sich auf den Tag `text` registriert, liefe. (4) Templater-Syntax `<% … %>` ist durch das
 * HTML-Escape gebrochen; `{{ … }}` wird von keinem bekannten Prozessor beim Rendern ausgeführt (nur beim Einfügen
 * einer Vorlage) und bleibt unverändert.
 */

/** Zaun-Zeile: Präfix aus Leerraum, `>`, Listenmarkern; dann ≥3 Backticks/Tilden; dann der Rest der Zeile. */
const FENCE_LINE = /^((?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*)(`{3,}|~{3,})(.*)$/;
/** Inline-Code-Span: gleich lange Backtick-Läufe, nicht über eine Leerzeile hinweg. */
const CODE_SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?)(?<!`)\1(?!`)/g;
/** ASCII-Satzzeichen außer `&` und `<` (die behandelt das HTML-Escape). */
const PUNCT = /[!-%'-/:;=>?@[-`{-~]/g;

function neutralizeFenceLine(line: string): string {
  const m = FENCE_LINE.exec(line);
  if (m === null || m[3].trim() === "") return line;
  return `${m[1]}${m[2]}text`;
}

function isInlineQuery(content: string): boolean {
  const c = content.trim();
  return c.startsWith("=") || c.includes("$=");
}

function neutralizeInlineQueries(chunk: string): string {
  return chunk.replace(CODE_SPAN, (span, ticks: string, content: string) => {
    if (!isInlineQuery(content)) return span;
    const fence = "\\`".repeat(ticks.length);
    return `${fence}${content.replace(PUNCT, (c) => `\\${c}`)}${fence}`;
  });
}

/** Inline-Code nur zwischen Zaun-Zeilen suchen: ein Span darf nie einen Zaun verschlucken. */
function neutralizeInline(text: string): string {
  const out: string[] = [];
  let chunk: string[] = [];
  const flush = (): void => { if (chunk.length > 0) out.push(neutralizeInlineQueries(chunk.join("\n"))); chunk = []; };
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) { flush(); out.push(line); } else chunk.push(line);
  }
  flush();
  return out.join("\n");
}

/** Macht Modell-Markdown unschädlich für Renderer und Post-Prozessoren (s. Kopfkommentar). */
export function neutralizeModelMarkdown(text: string): string {
  const fenced = text.split("\n").map(neutralizeFenceLine).join("\n");
  return neutralizeInline(fenced)
    .replace(/!\[\[([^\]\n]*)\]\]/g, (_m, inner: string) => `\`[[${inner}]]\``)
    .replace(/!\[([^\]]*)\]\(([^)\n]*)\)/g, (_m, alt: string, url: string) => `${alt} (${url})`)
    .replace(/!\[([^\]]*)\](?:\[[^\]]*\])?/g, "[$1]")
    .replace(/!\[/g, "[")
    .replace(/</g, "&lt;");
}
