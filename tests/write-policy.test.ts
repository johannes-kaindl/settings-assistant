// tests/write-policy.test.ts
import { describe, expect, it } from "vitest";
import { isWritable, targetPath } from "../src/core/write-policy";

describe("write-policy", () => {
  it("v1 writes plugin data and hotkeys only", () => {
    expect(isWritable({ kind: "plugin", id: "koda-agent" })).toBe(true);
    expect(isWritable({ kind: "obsidian", file: "hotkeys" })).toBe(true);
    expect(isWritable({ kind: "obsidian", file: "app" })).toBe(false);
    expect(isWritable({ kind: "obsidian", file: "appearance" })).toBe(false);
    expect(isWritable({ kind: "obsidian", file: "core-plugins" })).toBe(false);
    expect(isWritable({ kind: "obsidian", file: "community-plugins" })).toBe(false);
  });
  it("later stages open more files", () => {
    expect(isWritable({ kind: "obsidian", file: "app" }, 2)).toBe(true);
    expect(isWritable({ kind: "obsidian", file: "core-plugins" }, 2)).toBe(false);
    expect(isWritable({ kind: "obsidian", file: "community-plugins" }, 3)).toBe(true);
  });
  it("own data.json is never writable", () => {
    expect(isWritable({ kind: "plugin", id: "settings-assistant" }, 3)).toBe(false);
  });
  it("paths derive from configDir", () => {
    expect(targetPath({ kind: "plugin", id: "koda-agent" }, ".obs")).toBe(".obs/plugins/koda-agent/data.json");
    expect(targetPath({ kind: "obsidian", file: "hotkeys" }, ".obs")).toBe(".obs/hotkeys.json");
  });
  it.each(["../../x", "a/b", "", ".hidden", ".."])("invalid plugin id %j is neither writable nor addressable", (id) => {
    expect(isWritable({ kind: "plugin", id }, 3)).toBe(false);
    expect(() => targetPath({ kind: "plugin", id }, ".obs")).toThrow("invalid plugin id");
  });
  it.each(["koda-agent", "a.b_c-1"])("valid plugin id %j unchanged", (id) => {
    expect(isWritable({ kind: "plugin", id })).toBe(true);
    expect(targetPath({ kind: "plugin", id }, ".obs")).toBe(`.obs/plugins/${id}/data.json`);
  });
});
