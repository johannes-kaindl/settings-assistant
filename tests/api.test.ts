import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { Notice } from "./vendor/kit/obsidian-mock";
import type { ApplyPorts } from "../src/core/apply-run";
import type { CheckRow } from "../src/core/reconcile";
import { ApplyService } from "../src/obsidian/apply-service";
import { createSettingsAssistantApi, type ApplyApiService } from "../src/obsidian/api";
import { DEFAULT_GFS_POLICY } from "../src/vendor/kit/rotation";

const FILES = (): Record<string, string> => ({
  ".cfg/plugins/p/data.json": '{"a":1,"apiKey":"SECRET-VALUE","nested":{"token":"T0K"}}',
  ".cfg/plugins/settings-assistant/data.json": '{"endpoints":[{"url":"x"}]}',
  ".cfg/hotkeys.json": "{}",
});

function fakeApp(files: Record<string, string>) {
  const adapter = { exists: async (p: string) => p in files, read: async (p: string) => files[p] as string };
  return { vault: { configDir: ".cfg", adapter }, plugins: { plugins: {}, enabledPlugins: new Set<string>(), manifests: { p: { id: "p", name: "P" }, "settings-assistant": { id: "settings-assistant", name: "SA" } } } } as never;
}

function fakePorts(files: Record<string, string>): ApplyPorts {
  return {
    read: async (p) => files[p] ?? null, write: async (p, t) => { files[p] = t; }, remove: async () => {},
    isEnabled: () => false, disable: async () => {}, enable: async () => {},
    beginSnapshot: async () => ({ dir: "snap", finish: async () => {} }),
  };
}

function setup(over: Partial<ApplyApiService> = {}) {
  const files = FILES();
  const app = fakeApp(files);
  const confirm = vi.fn(async (rows: CheckRow[]) => rows);
  const real = new ApplyService(app, () => ({ retention: DEFAULT_GFS_POLICY }), { ports: fakePorts(files), confirm });
  const service: ApplyApiService = { busy: false, plan: (pr) => real.plan(pr), applyInteractive: (pr, o) => real.applyInteractive(pr, o) as ReturnType<ApplyApiService["applyInteractive"]>, ...over };
  const api = createSettingsAssistantApi({ app, service });
  return { api, confirm, files, real };
}

beforeEach(() => { Notice.instances.length = 0; });

describe("Anbieter-API v1", () => {
  it("(a) readSettings schwärzt Geheimnisse und nennt die Pfade", async () => {
    const { api } = setup();
    const r = await api.readSettings({ plugin: "p" });
    expect(r).toEqual({ settings: { a: 1, apiKey: "🔒", nested: { token: "🔒" } }, redacted: ["apiKey", "nested.token"] });
    expect(JSON.stringify(r)).not.toContain("SECRET-VALUE");
  });

  it("(M1) planProfile zeigt für die eigenen Einstellungen keine Ist-Werte (wie readSettings → own-settings)", async () => {
    const { api } = setup();
    const r = await api.planProfile({ version: 1, plugins: { "settings-assistant": { endpoints: [], localModel: "m" } } });
    expect(r).toEqual({ rows: [
      { target: "plugins.settings-assistant", path: "endpoints", status: "read-only" },
      { target: "plugins.settings-assistant", path: "localModel", status: "read-only" },
    ] });
  });

  it("(M7) die eigene Datei ist in jeder Schreibweise own-settings", async () => {
    const { api } = setup();
    expect(await api.readSettings({ plugin: "Settings-Assistant" })).toEqual({ error: "own-settings" });
  });

  it("(I1) Prototyp-Namen als Plugin-ID gelten als nicht installiert", async () => {
    const { api } = setup();
    expect(await api.readSettings({ plugin: "toString" })).toEqual({ error: "not-installed" });
    const r = await api.planProfile({ version: 1, plugins: { constructor: { x: 1 } } });
    expect(r).toEqual({ rows: [{ target: "plugins.constructor", path: "x", status: "not-installed", desired: 1 }] });
  });

  it("(b) planProfile mit ungültigem Profil liefert das Diagnosewort", async () => {
    const { api } = setup();
    expect(await api.planProfile({ version: 9 })).toEqual({ error: "future-version" });
    expect(await api.planProfile("{ nope SECRET-VALUE")).toEqual({ error: "invalid-json" });
  });

  it("(c) applyProfile während busy liefert { busy: true }", async () => {
    const { api } = setup({ busy: true });
    expect(await api.applyProfile({ version: 1, plugins: { p: { a: 2 } } }, { origin: "koda" })).toEqual({ busy: true });
    expect(api.status().busy).toBe(true);
  });

  it("(M10) applyProfile liefert ein korrigiertes actual nur geschwärzt", async () => {
    const row: CheckRow = { target: { kind: "plugin", id: "p" }, path: ["conn"], status: "change", checked: true, selectable: true, current: 1, desired: 2 };
    const { api } = setup({ applyInteractive: async () => ({ origin: "api:x", snapshotDir: "s", stopped: false, results: [{ row, outcome: "corrected", actual: { apiKey: "sk-API-CORR", n: 3 } }] }) });
    const r = await api.applyProfile({ version: 1, plugins: { p: { conn: 2 } } }, { origin: "x" });
    expect(JSON.stringify(r)).not.toContain("sk-API-CORR");
    expect(r).toEqual({ snapshot: "s", results: [{ path: "plugins.p.conn", outcome: "corrected", actual: { apiKey: "🔒", n: 3 } }] });
  });

  it("(d) tools() deklariert confirms provider für propose_settings, caller für read_settings", () => {
    const { api } = setup();
    const tools = api.tools();
    expect(tools.find((x) => x.name === "propose_settings")).toMatchObject({ writes: true, confirms: "provider" });
    expect(tools.find((x) => x.name === "read_settings")).toMatchObject({ writes: false, confirms: "caller" });
  });

  it("(e) execute(propose_settings) öffnet den eigenen Dialog; abgebrochen = cancelled", async () => {
    const { api, confirm, files } = setup();
    const r = await api.execute("propose_settings", { profile: { version: 1, plugins: { p: { a: 2 } } } });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ results: [{ path: "plugins.p.a", outcome: "written" }] });
    expect(JSON.parse(files[".cfg/plugins/p/data.json"] as string).a).toBe(2);
    confirm.mockResolvedValueOnce(null as never);
    expect(await api.execute("propose_settings", { profile: { version: 1, plugins: { p: { a: 3 } } } })).toEqual({ cancelled: true });
  });

  it("(e2) applyProfile hat keinen Weg an der Bestätigung vorbei", async () => {
    const { api, confirm } = setup();
    await api.applyProfile({ version: 1, plugins: { p: { a: 2 } } }, { origin: "x", confirm: false, skipConfirm: true, yes: true } as never);
    await api.execute("propose_settings", { profile: { version: 1, plugins: { p: { a: 3 } } }, skipConfirm: true, yes: true, confirm: false });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("(f) wirft der Service, kommt { error } ohne Dateiinhalt", async () => {
    const { api } = setup({ plan: async () => { throw new Error("boom SECRET-VALUE"); }, applyInteractive: async () => { throw new Error("boom SECRET-VALUE"); } });
    const a = await api.planProfile({ version: 1, plugins: { p: { a: 2 } } });
    const b = await api.applyProfile({ version: 1, plugins: { p: { a: 2 } } }, { origin: "x" });
    expect(a).toEqual({ error: "failed" });
    expect(b).toEqual({ error: "failed" });
  });

  it("(f2) Fehlertext des Service wird nicht durchgereicht", async () => {
    const { api } = setup({ applyInteractive: async () => ({ error: "ENOENT SECRET-VALUE" }) });
    expect(await api.applyProfile({ version: 1, plugins: { p: { a: 2 } } }, { origin: "x" })).toEqual({ error: "failed" });
  });

  it("(g) planProfile: secret-Zeile ohne current, desired, note", async () => {
    const { api } = setup();
    const r = await api.planProfile({ version: 1, plugins: { p: { apiKey: "NEW-KEY", a: 5 } }, notes: { "plugins.p.apiKey": "NOTIZ-GEHEIM" } });
    expect("rows" in r).toBe(true);
    if (!("rows" in r)) return;
    const sec = r.rows.find((x) => x.path === "apiKey");
    expect(sec).toEqual({ target: "plugins.p", path: "apiKey", status: "secret" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET-VALUE|NEW-KEY|NOTIZ-GEHEIM/);
    expect(r.rows.find((x) => x.path === "a")).toMatchObject({ status: "change", current: 1, desired: 5 });
  });

  it("(g2) Rand-Schutz: secret-Zeile mit Werten aus dem Service wird auf target/path/status gekürzt", async () => {
    const leaky: CheckRow = { target: { kind: "plugin", id: "p" }, path: ["apiKey"], status: "secret", current: "sk-LEAK", desired: "sk-LEAK2", note: "sk-LEAK3", checked: false, selectable: false };
    const { api } = setup({ plan: async () => [leaky] });
    const r = await api.planProfile({ version: 1, plugins: { p: { a: 1 } } });
    expect(r).toStrictEqual({ rows: [{ target: "plugins.p", path: "apiKey", status: "secret" }] });
    expect(JSON.stringify(r)).not.toContain("sk-LEAK");
  });

  it("(h) readSettings für settings-assistant selbst: own-settings", async () => {
    const { api } = setup();
    expect(await api.readSettings({ plugin: "settings-assistant" })).toEqual({ error: "own-settings" });
  });

  it("(h2) readSettings: nicht installiert, ungültige ID, unbekannte Datei, unlesbar", async () => {
    const { api, files } = setup();
    expect(await api.readSettings({ plugin: "zzz" })).toEqual({ error: "not-installed" });
    expect(await api.readSettings({ plugin: "../x" })).toEqual({ error: "bad-args" });
    expect(await api.readSettings({ file: "nope" } as never)).toEqual({ error: "bad-args" });
    files[".cfg/hotkeys.json"] = "{ SECRET-VALUE";
    expect(await api.readSettings({ file: "hotkeys" })).toEqual({ error: "unreadable" });
    files[".cfg/hotkeys.json"] = "{}";
    expect(await api.readSettings({ file: "hotkeys" })).toEqual({ settings: {}, redacted: [] });
  });

  it("(i) __proto__-Schlüssel und Plugin-ID ../x werfen nicht", async () => {
    const { api } = setup();
    const proto = JSON.parse('{"version":1,"plugins":{"p":{"__proto__":{"polluted":1}}}}') as unknown;
    const r1 = await api.planProfile(proto);
    expect(r1).toBeTruthy();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await api.planProfile({ version: 1, plugins: { "../x": { a: 1 } } })).toEqual({ error: "bad-section" });
    expect(await api.applyProfile({ version: 1, plugins: { "../x": { a: 1 } } }, { origin: "x" })).toEqual({ error: "bad-section" });
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    expect(await api.planProfile(cyc)).toEqual({ error: "invalid-profile" });
  });

  it("(j) manipulierter origin wird zu api:unknown, ein guter zu api:<origin>", async () => {
    const seen: string[] = [];
    const { api } = setup({ applyInteractive: async (_p, origin) => { seen.push(origin); return { cancelled: true }; } });
    const prof = { version: 1, plugins: { p: { a: 2 } } };
    await api.applyProfile(prof, { origin: "evil\nline" });
    await api.applyProfile(prof, { origin: "x".repeat(500) });
    await api.applyProfile(prof, { origin: "" });
    await api.applyProfile(prof, { origin: 5 as never });
    await api.applyProfile(prof, { origin: "koda-agent" });
    expect(seen).toEqual(["api:unknown", "api:unknown", "api:unknown", "api:unknown", "api:koda-agent"]);
  });

  it("status nennt Ziele, Stufe v1 und busy", () => {
    const { api } = setup();
    expect(api.apiVersion).toBe(1);
    expect(api.status()).toEqual({ busy: false, writable: ["plugins/*/data.json", "hotkeys"], stage: "v1" });
  });

  it("execute: unbekanntes Werkzeug und falsche Argumente", async () => {
    const { api } = setup();
    expect(await api.execute("nope", {})).toEqual({ error: "unknown-tool" });
    expect(await api.execute("read_settings", {})).toEqual({ error: "bad-args" });
    expect(await api.execute("read_settings", { plugin: "p", file: "app" })).toEqual({ error: "bad-args" });
    expect(await api.execute("propose_settings", null)).toEqual({ error: "bad-args" });
    expect(await api.execute("propose_settings", { profile: 5 })).toEqual({ error: "not-object" });
    expect(await api.execute("read_settings", { plugin: "p" })).toMatchObject({ redacted: ["apiKey", "nested.token"] });
  });
});
