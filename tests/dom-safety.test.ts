import { describe, expect, it } from "vitest";
import { makeFakeEl } from "./vendor/kit/obsidian-mock";
import { stripActiveContent } from "../src/obsidian/dom-safety";

describe("stripActiveContent", () => {
  it("stripActiveContent entfernt aktive Elemente und src/srcset", () => {
    const root = makeFakeEl();
    const img = root.createEl("img", { attr: { src: "https://evil/" } });
    const wrap = root.createDiv();
    wrap.createEl("iframe"); wrap.createEl("svg"); wrap.createEl("source");
    const a = wrap.createEl("a", { attr: { src: "https://x", srcset: "y" } });
    stripActiveContent(root);
    expect(root.querySelectorAll("img, iframe, svg, source, script, video").length).toBe(0);
    expect(root.children).not.toContain(img);
    expect(a.getAttribute("src")).toBeNull();
    expect(a.getAttribute("srcset")).toBeNull();
  });

  describe("stripActiveContent: Links (N1)", () => {
    const hrefAfter = (attr: Record<string, string>): string | null => {
      const root = makeFakeEl();
      const a = root.createEl("a", { text: "click", attr });
      stripActiveContent(root);
      expect(a.getText?.() ?? "click").toBe("click"); // Linktext bleibt sichtbar
      return a.getAttribute("href");
    };
    it.each([
      "javascript:alert(1)", "JavaScript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)", "\tjava\nscript:alert(1)", "\u0001javascript:alert(1)",
      "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "obsidian://open?vault=x", "file:///etc/passwd", "app://obsidian.md/x", "OBSIDIAN://x", "ftp://x/y",
    ])("%j verliert sein href", (href) => { expect(hrefAfter({ href })).toBeNull(); });
    it.each(["https://example.org/x", "HTTP://example.org", "mailto:a@b.de", "#Überschrift", "Notiz.md", "folder/Notiz.md#h", "?q=1"])("%j bleibt", (href) => {
      expect(hrefAfter({ href })).toBe(href);
    });
    it("interner Obsidian-Link (data-href) bleibt, auch bei Doppelpunkt im Namen", () => {
      expect(hrefAfter({ href: "Titel: Untertitel", "data-href": "Titel: Untertitel" })).toBe("Titel: Untertitel");
    });
    it("data-href macht ein javascript:-Ziel nicht harmlos", () => {
      expect(hrefAfter({ href: "javascript:alert(1)", "data-href": "x" })).toBeNull();
    });
    it("data-href ist eine Pauschal-Ausnahme: ein interner Link mit obsidian://-Ziel behält sein href (so festgehalten, nicht empfohlen; ob gekappt oder behalten, entscheidet Johannes in der Kit-Task „Linkschutz in Modellantworten“, Empfehlung: kappen)", () => {
      expect(hrefAfter({ href: "obsidian://open?vault=x", "data-href": "x" })).toBe("obsidian://open?vault=x");
    });
    it.each(["java\u200bscript:alert(1)", "\u200bjavascript:alert(1)", "java\u200dscript:alert(1)", "\ufeffjavascript:alert(1)", "java\u0085script:alert(1)", "java\u007fscript:alert(1)"])(
      "unsichtbare Zeichen im Schema (%j) verstecken es nicht", (href) => { expect(hrefAfter({ href })).toBeNull(); });
    it("verschachtelte Links werden alle geprüft", () => {
      const root = makeFakeEl();
      const a = root.createDiv().createEl("p").createEl("a", { attr: { href: "data:x" } });
      stripActiveContent(root);
      expect(a.getAttribute("href")).toBeNull();
    });
  });
});
