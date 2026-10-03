import { describe, expect, it } from "vitest";
import { neutralizeModelMarkdown } from "../src/core/chat-markdown";

describe("neutralizeModelMarkdown", () => {
  it("Bilder werden sichtbarer Text ohne Bildsyntax", () => {
    const out = neutralizeModelMarkdown("a ![pic](https://evil.example/?q=1) b");
    expect(out).not.toContain("![");
    expect(out).toContain("pic (https://evil.example/?q=1)");
  });
  it("Referenz-Bilder und Kurzformen verlieren die Bildsyntax", () => {
    expect(neutralizeModelMarkdown("![alt][r]\n\n[r]: https://evil.example/x")).not.toContain("![");
    expect(neutralizeModelMarkdown("![alt]")).not.toContain("![");
  });
  it("Wikilink-Embeds verlieren das Ausrufezeichen und stehen in Backticks", () => {
    const out = neutralizeModelMarkdown("see ![[secret.png]]");
    expect(out).not.toContain("![[");
    expect(out).toContain("`[[secret.png]]`");
  });
  it("rohes HTML wird escaped", () => {
    for (const tag of ["img", "iframe", "script", "video", "audio", "embed", "object", "link", "style", "svg", "div"]) {
      const out = neutralizeModelMarkdown(`x <${tag} src="https://evil.example"> y`);
      expect(out).not.toContain("<");
      expect(out).toContain(`&lt;${tag}`);
    }
  });
  it("Links bleiben Links", () => {
    expect(neutralizeModelMarkdown("[t](https://ok.example)")).toBe("[t](https://ok.example)");
  });
  const IMG = "![a](https://evil.example/?q=1)";
  const cases: Array<[string, string]> = [
    ["Backtick-Fence", "```\n" + IMG + "\n```"],
    ["eingerückter Fence (2 Leerzeichen)", "  ```\n" + IMG + "\n  ```"],
    ["~~~-Fence", "~~~\n" + IMG + "\n~~~"],
    ["nach unvollständigem Fence", "```\nx\n" + IMG],
    ["Backticks im Info-String", "``` a`b\n" + IMG + "\n```"],
    ["Embed im Fence", "```\n![[x.png]] <img src=y>\n```"],
  ];
  it.each(cases)("%s: auch hier keine Bildsyntax und kein <", (_n, text) => {
    const out = neutralizeModelMarkdown(text);
    expect(out).not.toContain("![");
    expect(out).not.toContain("<");
  });
});
