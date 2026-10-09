import { describe, expect, it } from "vitest";
import { applyLlmPatch, toLlmSettings } from "../src/core/llm-settings";
import { DEFAULT_SETTINGS, loadSettings } from "../src/core/settings";

describe("toLlmSettings", () => {
  it("bildet endpointChoice → choice und localModel → model ab, endpoints und request bleiben", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a" }], endpointChoice: { endpointId: "e1" }, localModel: "m" });
    const v = toLlmSettings(s);
    expect(v.endpoints).toBe(s.endpoints);
    expect(v.choice).toEqual({ endpointId: "e1" });
    expect(v.model).toBe("m");
    expect(v.request).toBe(s.request);
  });
});

describe("applyLlmPatch", () => {
  it("schreibt choice und model synchron auf die eigenen Felder zurück", () => {
    const s = loadSettings(undefined);
    applyLlmPatch(s, { choice: { endpointId: "e2", model: "x" }, model: "m2" });
    expect(s.endpointChoice).toEqual({ endpointId: "e2", model: "x" });
    expect(s.localModel).toBe("m2");
    expect(toLlmSettings(s).choice).toEqual({ endpointId: "e2", model: "x" });
  });
  it("übernimmt endpoints und request und lässt nicht genannte Felder stehen", () => {
    const s = loadSettings({ localModel: "keep" });
    const eps = [{ url: "http://b", secretId: "sid" }];
    applyLlmPatch(s, { endpoints: eps, request: { ...DEFAULT_SETTINGS.request, levelPickerInChat: true } });
    expect(s.endpoints).toBe(eps);
    expect(s.request.levelPickerInChat).toBe(true);
    expect(s.localModel).toBe("keep");
    expect(s.retention).toEqual(DEFAULT_SETTINGS.retention);
  });
  it("ein leerer Patch ändert nichts", () => {
    const s = loadSettings({ localModel: "m" });
    const before = JSON.stringify(s);
    applyLlmPatch(s, {});
    expect(JSON.stringify(s)).toBe(before);
  });
});
