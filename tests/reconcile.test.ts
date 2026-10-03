import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core/profile";
import { reconcile, type TargetState } from "../src/core/reconcile";
import type { SettingsProfile } from "../src/core/types";

const prof = (o: object): SettingsProfile => { const r = parseProfile(JSON.stringify({ version: 1, ...o })); if (!r.ok) throw new Error(); return r.profile; };
const koda = { kind: "plugin", id: "koda-agent" } as const;
const st = (text: string | null, installed = true): TargetState => ({ target: koda, installed, text });

describe("reconcile", () => {
  it("change / same / missing-key", () => {
    const rows = reconcile(prof({ plugins: { "koda-agent": { maxRounds: 20, contextWindowTokens: 128000, newKey: 1 } } }),
      [st('{"maxRounds":50,"contextWindowTokens":128000}')]);
    expect(rows.map((r) => [r.path.join("."), r.status, r.checked, r.selectable])).toEqual([
      ["maxRounds", "change", true, true],
      ["contextWindowTokens", "same", false, false],
      ["newKey", "missing-key", false, true],
    ]);
    expect(rows[0]).toMatchObject({ current: 50, desired: 20 });
  });
  it("carries notes", () => {
    const rows = reconcile(prof({ plugins: { "koda-agent": { maxRounds: 20 } }, notes: { "plugins.koda-agent.maxRounds": "why" } }), [st('{"maxRounds":50}')]);
    expect(rows[0]!.note).toBe("why");
  });
  it("secret rows carry no values — neither current nor desired", () => {
    const rows = reconcile(prof({ plugins: { "koda-agent": { apiKey: "sk-new" } } }), [st('{"apiKey":"sk-old"}')]);
    expect(rows[0]).toEqual({ target: koda, path: ["apiKey"], status: "secret", checked: false, selectable: false });
  });
  it("secret rows carry no note, other rows keep theirs", () => {
    const rows = reconcile(prof({ plugins: { "koda-agent": { apiKey: "sk-new", maxRounds: 20 } }, notes: { "plugins.koda-agent.apiKey": "sk-new again", "plugins.koda-agent.maxRounds": "why" } }), [st('{"apiKey":"sk-old","maxRounds":50}')]);
    expect(rows[0]!.status).toBe("secret");
    expect("note" in rows[0]!).toBe(false);
    expect(rows[1]!.note).toBe("why");
  });
  it("a secret object ancestor in the file makes nested profile keys secret", () => {
    const rows = reconcile(prof({ plugins: { "koda-agent": { hostSecrets: { h: "x" } } } }), [st('{"hostSecrets":{}}')]);
    expect(rows[0]!.status).toBe("secret");
    expect(rows[0]!.desired).toBeUndefined();
  });
  it("a list holding a secret in an element is secret — in the file or in the profile", () => {
    const inFile = reconcile(prof({ plugins: { "koda-agent": { endpoints: [] } } }), [st('{"endpoints":[{"url":"u","secretId":"s"}]}')]);
    expect(inFile[0]).toEqual({ target: koda, path: ["endpoints"], status: "secret", checked: false, selectable: false });
    const inProfile = reconcile(prof({ plugins: { "koda-agent": { endpoints: [{ url: "u", apiKey: "sk" }] } } }), [st('{"endpoints":[]}')]);
    expect(inProfile[0]!.status).toBe("secret");
  });
  it("not installed / unreadable / missing file", () => {
    expect(reconcile(prof({ plugins: { "koda-agent": { a: 1 } } }), [st(null, false)])[0]!.status).toBe("not-installed");
    expect(reconcile(prof({ plugins: { "koda-agent": { a: 1 } } }), [st("{oops")])[0]!.status).toBe("unreadable");
    expect(reconcile(prof({ plugins: { "koda-agent": { a: 1 } } }), [st(null)])[0]!.status).toBe("missing-key");
    expect(reconcile(prof({ plugins: { "koda-agent": { a: 1 } } }), [])[0]!.status).toBe("not-installed");
  });
  it("shape conflict when an ancestor in the file is not an object", () => {
    expect(reconcile(prof({ plugins: { "koda-agent": { llm: { model: "m" } } } }), [st('{"llm":"x"}')])[0]!.status).toBe("shape-conflict");
  });
  it("read-only for later stages and for the plugin itself", () => {
    const app = reconcile(prof({ app: { readableLineLength: true } }), [{ target: { kind: "obsidian", file: "app" }, installed: true, text: '{"readableLineLength":false}' }]);
    expect(app[0]).toMatchObject({ status: "read-only", current: false, desired: true, selectable: false });
    const self = reconcile(prof({ plugins: { "settings-assistant": { x: 1 } } }), [{ target: { kind: "plugin", id: "settings-assistant" }, installed: true, text: '{"x":0}' }]);
    expect(self[0]!.status).toBe("read-only");
  });
  it("hotkeys are writable in v1", () => {
    const rows = reconcile(prof({ hotkeys: { "editor:toggle-bold": [] } }), [{ target: { kind: "obsidian", file: "hotkeys" }, installed: true, text: null }]);
    expect(rows[0]!.status).toBe("missing-key");
  });
});
