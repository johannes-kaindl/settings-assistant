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

  it("prüft Endpunkte, Wahl und Request-Block", () => {
    const s = loadSettings({
      endpoints: [{ url: "http://a:1234", apiKey: "k", model: "m" }, { url: 5 }, "x", { url: "http://b" }],
      endpointChoice: { endpointId: "e1", model: 7 },
      request: { thinking: { structured: "bogus" } },
    });
    expect(s.endpoints).toEqual([{ url: "http://a:1234", apiKey: "k", model: "m" }, { url: "http://b" }]);
    expect(s.endpointChoice).toEqual({ endpointId: "e1" });
    expect(s.request.thinking).toEqual({});
  });
  describe("Migration des globalen Modells (localModel → Zeilenmodell)", () => {
    const rows = [{ url: "http://a:1234", model: "own" }, { url: "http://b" }, { url: "http://c", model: "  " }];

    it("füllt den Altwert nur in Zeilen ohne Modell und entfernt den Altschlüssel", () => {
      const s = loadSettings({ endpoints: rows, localModel: " old " });
      expect(s.endpoints.map((e) => e.model)).toEqual(["own", "old", "old"]);
      expect("localModel" in s).toBe(false);
    });

    it("ohne Altwert bleiben die Zeilen unverändert", () => {
      const s = loadSettings({ endpoints: rows });
      expect(s.endpoints.map((e) => e.model)).toEqual(["own", undefined, "  "]);
    });

    it("ein leerer oder nicht-String-Altwert ändert nichts, der Schlüssel verschwindet trotzdem", () => {
      for (const legacy of ["", "   ", 3, null]) {
        const s = loadSettings({ endpoints: rows, localModel: legacy });
        expect(s.endpoints.map((e) => e.model)).toEqual(["own", undefined, "  "]);
        expect("localModel" in s).toBe(false);
      }
    });

    it("zweiter Lauf: eine nach der Migration bewusst geleerte Zeile bleibt leer", () => {
      const first = loadSettings({ endpoints: [{ url: "http://a" }], localModel: "old" });
      const saved = JSON.parse(JSON.stringify(first)) as { endpoints: { url: string; model?: string }[] };
      expect(saved.endpoints[0]?.model).toBe("old");
      saved.endpoints[0] = { url: "http://a" };
      const second = loadSettings(saved);
      expect(second.endpoints[0]?.model).toBeUndefined();
      expect("localModel" in second).toBe(false);
    });

    it("ein Altwert ohne Zeilen geht verloren (nichts, wohin er könnte)", () => {
      const s = loadSettings({ localModel: "old" });
      expect(s.endpoints).toEqual([]);
      expect("localModel" in s).toBe(false);
    });
  });
});
