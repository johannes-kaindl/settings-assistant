import { describe, expect, it } from "vitest";
import { applyRows, PatchError } from "../src/core/patch";

describe("patch", () => {
  it("keeps unknown fields and key order, 2-space indent", () => {
    const before = '{\n  "a": 1,\n  "maxRounds": 50,\n  "z": {"keep": true}\n}';
    expect(applyRows(before, [{ path: ["maxRounds"], desired: 20 }])).toBe('{\n  "a": 1,\n  "maxRounds": 20,\n  "z": {\n    "keep": true\n  }\n}');
  });
  it("keeps tab indentation and a trailing newline", () => {
    expect(applyRows('{\n\t"a": 1\n}\n', [{ path: ["a"], desired: 2 }])).toBe('{\n\t"a": 2\n}\n');
  });
  it("keeps compact single-line files compact", () => {
    expect(applyRows('{"a":1,"b":2}', [{ path: ["b"], desired: 3 }])).toBe('{"a":1,"b":3}');
  });
  it("creates missing intermediate objects and appends new keys", () => {
    expect(applyRows('{"a":1}', [{ path: ["llm", "model"], desired: "m" }])).toBe('{"a":1,"llm":{"model":"m"}}');
  });
  it("replaces lists whole", () => {
    expect(applyRows('{"l":[1,2,3]}', [{ path: ["l"], desired: [9] }])).toBe('{"l":[9]}');
  });
  it("creates a missing file with 2-space indent", () => {
    expect(applyRows(null, [{ path: ["a"], desired: 1 }])).toBe('{\n  "a": 1\n}');
  });
  it("refuses to walk through a non-object", () => {
    expect(() => applyRows('{"llm":"x"}', [{ path: ["llm", "model"], desired: "m" }])).toThrow(PatchError);
  });
  it("does not share references with the desired value", () => {
    const desired = { k: 1 };
    const out = applyRows("{}", [{ path: ["o"], desired }]);
    desired.k = 2;
    expect(out).toBe('{"o":{"k":1}}');
  });
});
