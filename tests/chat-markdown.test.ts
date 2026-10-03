import { describe, expect, it } from "vitest";
import { neutralizeModelMarkdown, stripProfileBlocks } from "../src/core/chat-markdown";

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
  it("Links bleiben Links, Codeblöcke bleiben unberührt", () => {
    expect(neutralizeModelMarkdown("[t](https://ok.example)")).toBe("[t](https://ok.example)");
    const code = "```html\n<img src=x> ![a](b)\n```";
    expect(neutralizeModelMarkdown(code)).toBe(code);
  });
});

describe("stripProfileBlocks", () => {
  const body = '{"version":1}';
  it("entfernt vollständige Zäune", () => {
    expect(stripProfileBlocks(`a\n\`\`\`settings-profile\n${body}\n\`\`\`\nb`)).not.toContain("settings-profile");
  });
  it("entfernt einen unvollständigen Zaun bis Textende", () => {
    const out = stripProfileBlocks(`a\n\`\`\`settings-profile\n${body}\nmore`);
    expect(out).not.toContain("settings-profile");
    expect(out).not.toContain("more");
    expect(out).toContain("a");
  });
  it("entfernt ~~~-Zäune", () => {
    const out = stripProfileBlocks(`a\n~~~settings-profile\n${body}\n~~~\nb`);
    expect(out).not.toContain("settings-profile");
    expect(out).toContain("b");
  });
  it("lässt andere Zäune stehen", () => {
    expect(stripProfileBlocks("```json\n{}\n```")).toContain("```json");
  });
});
