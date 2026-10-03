import { beforeEach, describe, expect, it } from "vitest";
import { defineStrings, setLang } from "../src/vendor/kit/i18n";
import { STRINGS } from "../src/i18n/strings";
import { tn } from "../src/i18n/plural";

describe("tn", () => {
  beforeEach(() => { defineStrings(STRINGS); });

  it("waehlt Singular bei 1 und Plural sonst (en)", () => {
    setLang("en");
    expect(tn("modal.apply", 1)).toBe("Apply 1 change");
    expect(tn("modal.apply", 0)).toBe("Apply 0 changes");
    expect(tn("modal.apply", 3)).toBe("Apply 3 changes");
    expect(tn("restore.apply", 1)).toBe("Restore 1 file");
    expect(tn("restore.apply", 2)).toBe("Restore 2 files");
    expect(tn("snap.files", 1)).toBe("1 file");
    expect(tn("snap.files", 5)).toBe("5 files");
  });

  it("waehlt Singular bei 1 und Plural sonst (de)", () => {
    setLang("de");
    expect(tn("modal.apply", 1)).toBe("1 Änderung anwenden");
    expect(tn("modal.apply", 2)).toBe("2 Änderungen anwenden");
    expect(tn("restore.apply", 1)).toBe("1 Datei zurückholen");
    expect(tn("restore.apply", 4)).toBe("4 Dateien zurückholen");
    expect(tn("snap.files", 1)).toBe("1 Datei");
    expect(tn("snap.files", 2)).toBe("2 Dateien");
    setLang("en");
  });
});
