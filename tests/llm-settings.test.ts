import { describe, expect, it } from "vitest";
import { applyLlmPatch, toLlmSettings } from "../src/core/llm-settings";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";

describe("toLlmSettings", () => {
  it("bildet endpointChoice → choice ab, endpoints und request bleiben, es gibt kein globales Modell", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a", model: "m" }], endpointChoice: { endpointId: "e1" } });
    const v = toLlmSettings(s);
    expect(v.endpoints).toBe(s.endpoints);
    expect(v.choice).toEqual({ endpointId: "e1" });
    expect("model" in v).toBe(false);
    expect(v.request).toBe(s.request);
  });
});

describe("applyLlmPatch", () => {
  it("schreibt choice synchron auf das eigene Feld zurück", () => {
    const s = loadSettings(undefined);
    applyLlmPatch(s, { choice: { endpointId: "e2", model: "x" } });
    expect(s.endpointChoice).toEqual({ endpointId: "e2", model: "x" });
    expect(toLlmSettings(s).choice).toEqual({ endpointId: "e2", model: "x" });
  });
  it("übernimmt endpoints und request und lässt nicht genannte Felder stehen", () => {
    const s = loadSettings({ endpointChoice: { endpointId: "keep" } });
    const eps = [{ url: "http://b", secretId: "sid" }];
    applyLlmPatch(s, { endpoints: eps, request: { ...DEFAULT_SETTINGS.request, levelPickerInChat: true } });
    expect(s.endpoints).toBe(eps);
    expect(s.request.levelPickerInChat).toBe(true);
    expect(s.endpointChoice).toEqual({ endpointId: "keep" });
    expect(s.retention).toEqual(DEFAULT_SETTINGS.retention);
  });
  it("ignoriert ein `model` im Patch: das Modell lebt nur in der Zeile, es gibt kein globales Feld mehr", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a", model: "m" }] });
    applyLlmPatch(s, { model: "global" } as Parameters<typeof applyLlmPatch>[1]);
    expect("localModel" in s).toBe(false);
    expect(s.endpoints[0]?.model).toBe("m");
  });
  it("ein leerer Patch ändert nichts", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a", model: "m" }] });
    const before = JSON.stringify(s);
    applyLlmPatch(s, {});
    expect(JSON.stringify(s)).toBe(before);
  });
});
