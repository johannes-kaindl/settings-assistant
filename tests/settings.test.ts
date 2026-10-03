import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";
import { DEFAULT_GFS_POLICY } from "../src/vendor/kit/rotation";

describe("loadSettings", () => {
  it("undefined und Nicht-Objekte ergeben die Defaults", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.retention).toEqual(DEFAULT_GFS_POLICY);
  });

  it("teilt keine Referenzen mit den Defaults", () => {
    const s = loadSettings(undefined);
    s.retention.today = 99;
    s.endpoints.push({ url: "http://x" });
    expect(DEFAULT_SETTINGS.retention.today).toBe(DEFAULT_GFS_POLICY.today);
    expect(DEFAULT_SETTINGS.endpoints).toEqual([]);
  });

  it("negativer Aufbewahrungswert fällt auf den Default des Feldes zurück", () => {
    const s = loadSettings({ retention: { today: -1, days: 7, weeks: 4, months: 6 } });
    expect(s.retention).toEqual({ today: 6, days: 7, weeks: 4, months: 6 });
  });

  it("nicht-ganzzahlig, NaN, Text und fehlend fallen je Feld zurück; 0 bleibt (heißt: keine)", () => {
    const s = loadSettings({ retention: { today: 2.5, days: "7", weeks: 0, months: Number.NaN } });
    expect(s.retention).toEqual({ today: 6, days: 7, weeks: 0, months: 6 });
    expect(loadSettings({ retention: "kaputt" }).retention).toEqual(DEFAULT_GFS_POLICY);
    expect(loadSettings({ retention: { days: 3 } }).retention).toEqual({ ...DEFAULT_GFS_POLICY, days: 3 });
  });

  it("unbekannte Felder bleiben erhalten", () => {
    const s = loadSettings({ future: { a: 1 }, retention: { today: 3, days: 7, weeks: 4, months: 6 } }) as unknown as Record<string, unknown>;
    expect(s["future"]).toEqual({ a: 1 });
    expect((s["retention"] as { today: number }).today).toBe(3);
  });

  it("behält id und secretId der Endpunkte (Schlüsselbund-Verweis darf beim Laden nicht verloren gehen)", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a:1234", id: "ab12", secretId: "settings-assistant-ab12", model: "m" }, { url: "http://b", id: 5, secretId: 7 }] });
    expect(s.endpoints).toEqual([{ url: "http://a:1234", id: "ab12", secretId: "settings-assistant-ab12", model: "m" }, { url: "http://b" }]);
  });

  it("prüft Endpunkte, Wahl, lokales Modell und Request-Block", () => {
    const s = loadSettings({
      endpoints: [{ url: "http://a:1234", apiKey: "k", model: "m" }, { url: 5 }, "x", { url: "http://b" }],
      endpointChoice: { endpointId: "e1", model: 7 },
      localModel: 3,
      request: { thinking: { structured: "bogus" } },
    });
    expect(s.endpoints).toEqual([{ url: "http://a:1234", apiKey: "k", model: "m" }, { url: "http://b" }]);
    expect(s.endpointChoice).toEqual({ endpointId: "e1" });
    expect(s.localModel).toBe("");
    expect(s.request.thinking).toEqual({});
  });
});
