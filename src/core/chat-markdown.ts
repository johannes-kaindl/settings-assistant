/**
 * Neutralisiert Markdown aus nicht vertrauenswürdiger Quelle (LLM-Antwort) VOR `MarkdownRenderer.render`.
 * Rein, ohne Abhängigkeiten — gedacht als hebbares Modul (Kit-Kandidat `safe-markdown`).
 *
 * Bedrohungsmodell: `MarkdownRenderer.render` führt alles aus, was im Vault registriert ist, nicht nur Obsidians Kern.
 * - Fremde Codeblock-Prozessoren: ein Zaun mit Sprach-Tag (```` ```dataviewjs ````, `~~~dataview`, …) startet den
 *   Prozessor des jeweiligen Plugins; bei Dataview-JS ist das Ausführung beliebigen Codes im Renderer.
 * - Inline-Prozessoren: Inline-Code wie `` `$= dv.pages()` `` oder `` `= this.file.name` `` (Dataview, Präfix
 *   konfigurierbar) wird ebenfalls ausgeführt.
 * - Remote-Bilder und Embeds: `![…](url)`, `![…][ref]`, `![[…]]` laden von selbst und können Kontext ausleiten.
 * - HTML: `<img>`, `<iframe>`, `<script>`, …
 *
 * Strategie: ENTFERNEN statt ERKENNEN (Parser-Differential-Resistenz). Jede Fassung, die Zäune oder Code-Spans erkennen
 * und gezielt umschreiben will, liest Zeilenenden (`\r`, `\r\n`), Einzüge, Backtick-Längen und mehrzeilige Spans
 * irgendwann anders als der Renderer. Darum wird die Möglichkeit, Code-Elemente zu erzeugen, beseitigt:
 * 1. JEDES Backtick-Zeichen (U+0060) wird U+02CB „ˋ“ — damit gibt es weder Backtick-Zäune noch Inline-Code-Spans.
 * 2. JEDE Folge von ≥ 3 Tilden wird zu ebenso vielen U+02DC „˜“ — damit gibt es keine Tilde-Zäune, egal hinter welchem
 *    Einzug, Zitat- oder Listenpräfix und nach welchem Zeilenende. (Durchstreichen mit `~~` bleibt.)
 * 3. Bilder werden Text, `![[…]]` wird literaler Text `[[…]]` (escaped, kein Link), jedes `<` wird `&lt;`.
 * 4. Mit vier Leerzeichen eingerückte Blöcke bleiben: sie tragen keinen Sprach-Tag und starten keinen Prozessor.
 * Links bleiben (ein Klick ist eine Nutzerhandlung). Code-Formatierung in Chat-Antworten geht dadurch verloren —
 * akzeptiert; Profilblöcke werden VOR dieser Funktion aus dem Rohtext gezogen und eigens gerendert.
 *
 * Restrisiko: (1) Post-Prozessoren, die gewöhnlichen Text oder Links verarbeiten (Link-Vorschau, Karten, Tag-Plugins),
 * laufen weiter; eine zweite Linie nach dem Rendern bleibt nötig (`stripActiveContent` in der Ansicht). (2) Ein Plugin,
 * das ohne Code-Element auf reinen Text-Mustern Code ausführt, ist nicht abgedeckt (keines bekannt). Templater-Syntax
 * `<% … %>` ist durch das HTML-Escape gebrochen; `{{ … }}` wird beim Rendern von keinem bekannten Prozessor ausgeführt.
 */

const BACKTICK = /`/g;
const TILDE_RUN = /~{3,}/g;

/** Macht Modell-Markdown unschädlich für Renderer und Prozessoren (s. Kopfkommentar). */
export function neutralizeModelMarkdown(text: string): string {
  return text
    .replace(/!\[\[([^\]\n\r]*)\]\]/g, (_m, inner: string) => `\\[\\[${inner}\\]\\]`)
    .replace(/!\[([^\]]*)\]\(([^)\n\r]*)\)/g, (_m, alt: string, url: string) => `${alt} (${url})`)
    .replace(/!\[([^\]]*)\](?:\[[^\]]*\])?/g, "[$1]")
    .replace(/!\[/g, "[")
    .replace(/</g, "&lt;")
    .replace(BACKTICK, "ˋ")
    .replace(TILDE_RUN, (run) => "˜".repeat(run.length));
}
