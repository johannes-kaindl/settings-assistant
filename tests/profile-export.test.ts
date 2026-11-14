import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core/profile";
import { findProfileFences } from "../src/core/profile-fence";
import { redactedProfileNote } from "../src/core/profile-note";
import { profileFromState } from "../src/core/profile-export";
import { reconcile } from "../src/core/reconcile";

const state = JSON.stringify({ maxRounds: 20, model: "m1", nested: { theme: "dark", list: [1, 2] }, apiKey: "sk-LEAK-VALUE", endpoints: [{ url: "http://x", secretId: "id-LEAK" }] });

function noteFor(id: string, text: string | null): { text: string; redacted: string[] } {
  const r = profileFromState(id, text);
  if (!r.ok) throw new Error(`Export abgelehnt: ${r.reason}`);
  return redactedProfileNote(r.profile);
}

describe("profile-export", () => {
  it("der Ist-Stand wird ein Profil mit einem Eintrag, Werte unverändert, ohne Notizen", () => {
    const r = profileFromState("some-plugin", state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.entries).toHaveLength(1);
    expect(r.profile.entries[0].target).toEqual({ kind: "plugin", id: "some-plugin" });
    expect((r.profile.entries[0].values as { maxRounds: number }).maxRounds).toBe(20);
    expect(r.profile.notes).toEqual({});
  });

  it("jede Ablehnung nennt nur einen Grund: kein Text, keine JSON-Meldung, kein Wert", () => {
    const secretBroken = '{"apiKey": "sk-LEAK-VALUE", oops';
    const refusals: Array<[string, string | null, string]> = [
      ["settings-assistant", state, "self"],
      ["../evil", state, "bad-id"],
      ["some-plugin", null, "no-file"],
      ["some-plugin", secretBroken, "unreadable"],
      ["some-plugin", "[1,2]", "not-object"],
      ["some-plugin", "{}", "empty"],
    ];
    for (const [id, text, reason] of refusals) {
      const r = profileFromState(id, text);
      expect(r).toEqual({ ok: false, reason });
      expect(JSON.stringify(r)).not.toContain("LEAK");
    }
  });

  it("die abgelegte Notiz trägt kein Geheimnis und nennt nur die Pfade der zurückgehaltenen Werte", () => {
    const n = noteFor("some-plugin", state);
    expect(n.text).not.toContain("LEAK");
    expect(n.redacted).toEqual(["plugins.some-plugin.apiKey", "plugins.some-plugin.endpoints.0.secretId"]);
    expect(n.text.startsWith("```settings-profile\n")).toBe(true);
  });

  it("Rundweg: die Notiz lässt sich als Profil lesen, und gegen denselben Stand geprüft ändert sie nichts (nur Geheimnisse bleiben ausgelassen)", () => {
    const n = noteFor("some-plugin", state);
    const fence = findProfileFences(n.text).find((f) => f.closed);
    expect(fence).toBeDefined();
    const parsed = parseProfile(fence!.body.trim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rows = reconcile(parsed.profile, [{ target: { kind: "plugin", id: "some-plugin" }, installed: true, text: state }]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.status === "change")).toEqual([]);
    expect(rows.filter((r) => r.status === "secret").length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "same" || r.status === "secret")).toBe(true);
  });

  it("Gegenprobe des Rundwegs: ein geänderter Stand wird als Änderung erkannt (die Prüfung kann also rot werden)", () => {
    const n = noteFor("some-plugin", state);
    const fence = findProfileFences(n.text).find((f) => f.closed)!;
    const parsed = parseProfile(fence.body.trim());
    if (!parsed.ok) throw new Error("Profil nicht lesbar");
    const other = JSON.stringify({ ...JSON.parse(state), maxRounds: 5 });
    const rows = reconcile(parsed.profile, [{ target: { kind: "plugin", id: "some-plugin" }, installed: true, text: other }]);
    expect(rows.filter((r) => r.status === "change").map((r) => r.path.join("."))).toEqual(["maxRounds"]);
  });
});
