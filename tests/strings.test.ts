import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings";

describe("strings", () => {
  it("traegt den Plugin-Namen in beiden Sprachen", () => {
    expect(STRINGS.en["plugin.name"]).toBe("Settings Assistant");
    expect(STRINGS.de["plugin.name"]).toBe("Settings Assistant");
  });
  it("(F2) der Schnappschuss-Hinweis nennt die Geheimnisse anderer Plugins", () => {
    expect(STRINGS.en["snap.hint"]).toContain("Snapshots hold the files unchanged, including secrets of other plugins.");
    expect(STRINGS.de["snap.hint"]).toContain("Schnappschüsse enthalten die Dateien unverändert, auch Geheimnisse anderer Plugins.");
  });
});
