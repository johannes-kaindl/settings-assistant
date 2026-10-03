// tests/profile.test.ts
import { describe, expect, it } from "vitest";
import { noteKey, parseProfile, serializeProfile } from "../src/core/profile";

const ok = (text: string) => {
  const r = parseProfile(text);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.profile;
};

describe("profile", () => {
  it("reads plugins, obsidian files and notes", () => {
    const p = ok(JSON.stringify({
      version: 1,
      plugins: { "koda-agent": { maxRounds: 20 } },
      hotkeys: { "editor:toggle-bold": [{ modifiers: ["Mod"], key: "B" }] },
      notes: { "plugins.koda-agent.maxRounds": "shorter runs" },
    }));
    expect(p.entries).toEqual([
      { target: { kind: "plugin", id: "koda-agent" }, values: { maxRounds: 20 } },
      { target: { kind: "obsidian", file: "hotkeys" }, values: { "editor:toggle-bold": [{ modifiers: ["Mod"], key: "B" }] } },
    ]);
    expect(p.notes).toEqual({ "plugins.koda-agent.maxRounds": "shorter runs" });
    expect(p.unknownSections).toEqual([]);
  });
  it("keeps types exact", () => {
    const p = ok('{"version":1,"plugins":{"x":{"n":128000,"s":"on"}}}');
    expect(p.entries[0]!.values).toEqual({ n: 128000, s: "on" });
  });
  it("reports unknown sections instead of dropping them", () => {
    expect(ok('{"version":1,"themes":{}}').unknownSections).toEqual(["themes"]);
  });
  it("rejects a future version", () => {
    expect(parseProfile('{"version":2}')).toEqual({ ok: false, error: { code: "future-version", version: 2 } });
  });
  it("rejects missing or odd versions", () => {
    expect(parseProfile("{}")).toEqual({ ok: false, error: { code: "missing-version" } });
    expect(parseProfile('{"version":0}')).toEqual({ ok: false, error: { code: "bad-version", version: 0 } });
  });
  it("rejects invalid json and non-objects", () => {
    expect(parseProfile("{").ok).toBe(false);
    expect(parseProfile("[]")).toEqual({ ok: false, error: { code: "not-object" } });
  });
  it.each(["../../x", "a/b", "..", "", ".hidden"])("rejects plugin id %j (no path escape)", (id) => {
    const r = parseProfile(JSON.stringify({ version: 1, plugins: { [id]: { a: 1 } } }));
    expect(r).toEqual({ ok: false, error: { code: "bad-section", section: `plugins.${id}`, reason: "bad-id" } });
  });
  it("rejects plugin values that are not objects", () => {
    const r = parseProfile('{"version":1,"plugins":{"x":5}}');
    expect(r).toEqual({ ok: false, error: { code: "bad-section", section: "plugins.x", reason: "not-object" } });
  });
  it("serialize → parse round-trips", () => {
    const text = '{"version":1,"plugins":{"a":{"b":{"c":1}}},"app":{"x":true},"notes":{"app.x":"why"}}';
    expect(ok(serializeProfile(ok(text)))).toEqual(ok(text));
  });
  it("noteKey", () => {
    expect(noteKey({ kind: "plugin", id: "koda-agent" }, ["llm", "model"])).toBe("plugins.koda-agent.llm.model");
  });
});
