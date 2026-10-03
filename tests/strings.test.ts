import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings";

describe("strings", () => {
  it("traegt den Plugin-Namen in beiden Sprachen", () => {
    expect(STRINGS.en["plugin.name"]).toBe("Settings Assistant");
    expect(STRINGS.de["plugin.name"]).toBe("Settings Assistant");
  });
});
