/** Reine Textfunktionen für die Chat-Antwort. Modellausgabe ist nicht vertrauenswürdig: `MarkdownRenderer` lädt Bilder,
 *  Embeds und HTML von selbst und könnte so Kontextdaten an eine fremde URL schicken. */

/** Macht Modell-Markdown unschädlich für das automatische Laden: Bilder werden Text, Embeds Code, HTML wird escaped.
 *  Bewusst OHNE Fence-Erkennung: jede Abweichung von der Erkennung des Renderers (Einrückung, Info-String, Schließer)
 *  ließe ein Bild ungeprüft durch. Der Text wird einheitlich umgeschrieben, auch in Codeblöcken. Links bleiben
 *  (ein Klick ist eine Nutzerhandlung). */
export function neutralizeModelMarkdown(text: string): string {
  return text
    .replace(/!\[\[([^\]\n]*)\]\]/g, (_m, inner: string) => `\`[[${inner}]]\``)
    .replace(/!\[([^\]]*)\]\(([^)\n]*)\)/g, (_m, alt: string, url: string) => `${alt} (${url})`)
    .replace(/!\[([^\]]*)\](?:\[[^\]]*\])?/g, "[$1]")
    .replace(/!\[/g, "[")
    .replace(/</g, "&lt;");
}
