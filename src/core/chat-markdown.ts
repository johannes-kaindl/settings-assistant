/** Reine Textfunktionen für die Chat-Antwort. Modellausgabe ist nicht vertrauenswürdig: `MarkdownRenderer` lädt Bilder,
 *  Embeds und HTML von selbst und könnte so Kontextdaten an eine fremde URL schicken. */

// Zäune ``` oder ~~~ mit dem Tag settings-profile — vollständig, oder unvollständig bis Textende.
const PROFILE_FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})settings-profile[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)|$)/g;

/** Entfernt Profilblöcke aus dem Text, damit der Codeblock-Prozessor sie nicht ein zweites Mal rendert. */
export function stripProfileBlocks(text: string): string {
  return text.replace(PROFILE_FENCE, "$1").trim();
}

const CODE_FENCE = /(^|\n)([ \t]*(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\3[ \t]*(?=\n|$)|$)|$))/g;

function neutralizePlain(s: string): string {
  return s
    .replace(/!\[\[([^\]\n]*)\]\]/g, (_m, inner: string) => `\`[[${inner}]]\``)
    .replace(/!\[([^\]]*)\]\(([^)\n]*)\)/g, (_m, alt: string, url: string) => `${alt} (${url})`)
    .replace(/!\[([^\]]*)\](?:\[[^\]]*\])?/g, "[$1]")
    .replace(/!\[/g, "[")
    .replace(/</g, "&lt;");
}

/** Macht Modell-Markdown unschädlich für das automatische Laden: Bilder werden Text, Embeds Code, HTML wird escaped.
 *  Links bleiben (ein Klick ist eine Nutzerhandlung); Codeblöcke bleiben unverändert. */
export function neutralizeModelMarkdown(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE_FENCE)) {
    const start = (m.index ?? 0) + m[1].length;
    out += neutralizePlain(text.slice(last, start)) + text.slice(start, (m.index ?? 0) + m[0].length);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + neutralizePlain(text.slice(last));
}
