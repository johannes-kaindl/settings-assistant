import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core/profile";
import { profileNoteName, redactedProfileNote } from "../src/core/profile-note";

const prof = (o: object) => { const r = parseProfile(JSON.stringify({ version: 1, ...o })); if (!r.ok) throw new Error(); return r.profile; };

describe("profile-note", () => {
  it("schwärzt geheime Werte und nennt nur Pfade; Notizen betroffener Ziele entfallen", () => {
    const r = redactedProfileNote(prof({ plugins: { a: { apiKey: "sk-LEAK", n: 1 }, b: { n: 2 } }, notes: { "plugins.a.apiKey": "sk-LEAK again", "plugins.b.n": "why" } }));
    expect(r.text).not.toContain("sk-LEAK");
    expect(r.redacted).toEqual(["plugins.a.apiKey"]);
    expect(r.text).toContain("why");
    expect(r.text.startsWith("```settings-profile\n")).toBe(true);
  });
  it("ohne Geheimnis nichts geschwärzt", () => {
    expect(redactedProfileNote(prof({ plugins: { a: { n: 1 } } })).redacted).toEqual([]);
  });
  it("ein Wert mit drei Backticks sprengt den Zaun nicht", () => {
    const r = redactedProfileNote(prof({ plugins: { a: { tpl: "x ```` y ``` z" } } }));
    const fence = r.text.split("\n")[0].replace("settings-profile", "");
    expect(fence.length).toBeGreaterThan(4);
    expect(r.text.trimEnd().endsWith(fence)).toBe(true);
  });
  it("Dateiname mit Ortszeit", () => {
    expect(profileNoteName(new Date(2026, 9, 3, 7, 5))).toBe("Settings profile 2026-10-03 07-05");
  });
});
