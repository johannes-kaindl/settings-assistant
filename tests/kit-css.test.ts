import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findVendoredCss, missingKitCss } from "./vendor/kit/kit-css";

describe("Kit-CSS", () => {
  it("jede gevendorte *_CSS-Konstante steht wortgleich in styles.css", () => {
    const vendorDir = "src/vendor/kit-obsidian";
    expect(findVendoredCss(vendorDir).length).toBeGreaterThan(0);
    expect(missingKitCss(vendorDir, readFileSync("styles.css", "utf8"))).toEqual([]);
  });

  it("styles.css trägt keine Einsetzung `${…}` (ein Rohtext-Kopieren einer Kit-Konstante mit Einsetzung: Store-Scorecard „Caution“, Unknown word)", () => {
    expect(readFileSync("styles.css", "utf8")).not.toContain("${");
  });

  it("MODEL_BAR_CSS steht vor CHAT_WINDOW_CSS (Kit 0.73.0): die Regel in @container verliert sonst gegen eine spätere gleicher Spezifität", () => {
    const css = readFileSync("styles.css", "utf8");
    const marker = (name: string): number => css.indexOf(`(${name}), obsidian-kit`);
    expect(marker("MODEL_BAR_CSS")).toBeGreaterThan(-1);
    expect(marker("CHAT_WINDOW_CSS")).toBeGreaterThan(-1);
    expect(marker("MODEL_BAR_CSS")).toBeLessThan(marker("CHAT_WINDOW_CSS"));
  });

  it("CHAT_ARCHIVE_CSS ist kopiert, weil das Chat-Fenster den Verlauf zeigt (Option archive)", () => {
    const names = findVendoredCss("src/vendor/kit-obsidian").map((c) => c.name);
    expect(names).toContain("CHAT_ARCHIVE_CSS");
    expect(missingKitCss("src/vendor/kit-obsidian", readFileSync("styles.css", "utf8"))).not.toContain("CHAT_ARCHIVE_CSS");
  });
});
