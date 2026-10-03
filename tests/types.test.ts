// tests/types.test.ts
import { describe, expect, it } from "vitest";
import { deepEqual, getAt, leaves, sameTarget, targetKey } from "../src/core/types";

describe("types", () => {
  it("leaves: nested objects become dotted leaves, arrays and empty objects are leaves", () => {
    expect(leaves({ a: 1, b: { c: true, d: [1, 2] }, e: {} })).toEqual([
      { path: ["a"], value: 1 },
      { path: ["b", "c"], value: true },
      { path: ["b", "d"], value: [1, 2] },
      { path: ["e"], value: {} },
    ]);
  });
  it("leaves: a non-object root is one leaf with the empty path", () => {
    expect(leaves(["x"])).toEqual([{ path: [], value: ["x"] }]);
  });
  it("getAt: walks objects, stops at non-objects", () => {
    const root = { a: { b: 2 }, s: "x" };
    expect(getAt(root, ["a", "b"])).toBe(2);
    expect(getAt(root, ["a", "z"])).toBeUndefined();
    expect(getAt(root, ["s", "length"])).toBeUndefined();
    expect(getAt(null, ["a"])).toBeUndefined();
    expect(getAt(root, [])).toEqual(root);
  });
  it("deepEqual: structural, order-insensitive for keys, order-sensitive for arrays", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });
  it("targets", () => {
    expect(sameTarget({ kind: "plugin", id: "a" }, { kind: "plugin", id: "a" })).toBe(true);
    expect(sameTarget({ kind: "plugin", id: "a" }, { kind: "obsidian", file: "app" })).toBe(false);
    expect(targetKey({ kind: "plugin", id: "koda-agent" })).toBe("plugins.koda-agent");
    expect(targetKey({ kind: "obsidian", file: "hotkeys" })).toBe("hotkeys");
  });
});
