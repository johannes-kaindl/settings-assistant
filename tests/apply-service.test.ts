import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { makeFakeEl, Notice } from "./vendor/kit/obsidian-mock";
import type { ApplyPorts } from "../src/core/apply-run";
import type { CheckRow } from "../src/core/reconcile";
import type { SettingsProfile } from "../src/core/types";
import { DEFAULT_GFS_POLICY } from "../src/vendor/kit/rotation";

const prune = vi.fn(async () => [] as string[]);
vi.mock("../src/obsidian/snapshots", async (orig) => ({ ...(await orig<typeof import("../src/obsidian/snapshots")>()), pruneSnapshots: (...a: unknown[]) => (prune as (...x: unknown[]) => Promise<string[]>)(...a) }));

import { ApplyService, formatReport } from "../src/obsidian/apply-service";
import { renderCheckRows } from "../src/obsidian/check-rows-view";

const profile: SettingsProfile = {
  version: 1, notes: { "plugins.p.a": "weil" }, unknownSections: [],
  entries: [{ target: { kind: "plugin", id: "p" }, values: { a: 2 } }],
};

function fakeApp(files: Record<string, string>) {
  const adapter = {
    exists: async (p: string) => p in files,
    read: async (p: string) => files[p] as string,
  };
  return { vault: { configDir: ".cfg", adapter }, plugins: { plugins: {}, enabledPlugins: new Set(["p"]), manifests: { p: { id: "p", name: "P" }, q: { id: "q", name: "Q" } } } } as never;
}

function fakePorts() {
  const files: Record<string, string> = { ".cfg/plugins/p/data.json": '{"a":1}' };
  const writes: string[] = [];
  const ports: ApplyPorts = {
    read: async (p) => files[p] ?? null,
    write: async (p, t) => { files[p] = t; writes.push(p); },
    remove: async () => {},
    isEnabled: () => false, disable: async () => {}, enable: async () => {},
    beginSnapshot: async () => ({ dir: "snap", finish: async () => {} }),
  };
  return { ports, writes, files };
}

beforeEach(() => { prune.mockClear(); Notice.instances.length = 0; });
const settings = () => ({ retention: DEFAULT_GFS_POLICY });

describe("ApplyService", () => {
  it("zweiter Aufruf während eines laufenden liefert busy", async () => {
    const { ports } = fakePorts();
    let entered = false;
    let release: (v: CheckRow[] | null) => void = () => {};
    const svc = new ApplyService(fakeApp({ ".cfg/plugins/p/data.json": '{"a":1}' }), settings, { ports, confirm: () => new Promise((r) => { entered = true; release = r; }) });
    const first = svc.applyInteractive(profile, "x");
    await vi.waitFor(() => expect(svc.busy).toBe(true));
    await vi.waitFor(() => expect(entered).toBe(true));
    expect(await svc.applyInteractive(profile, "y")).toEqual({ busy: true });
    release(null);
    expect(await first).toEqual({ cancelled: true });
    expect(svc.busy).toBe(false);
  });

  it("Abbruch im Dialog schreibt nichts", async () => {
    const { ports, writes } = fakePorts();
    const svc = new ApplyService(fakeApp({ ".cfg/plugins/p/data.json": '{"a":1}' }), settings, { ports, confirm: async () => null });
    expect(await svc.applyInteractive(profile, "x")).toEqual({ cancelled: true });
    expect(writes).toEqual([]);
    expect(prune).not.toHaveBeenCalled();
  });

  it("nach Erfolg wird pruneSnapshots mit der Retention gerufen; origin steht im Bericht; willReload nennt aktive Plugins", async () => {
    const { ports, writes } = fakePorts();
    const confirm = vi.fn(async (rows: CheckRow[], _reload: string[]) => rows);
    const svc = new ApplyService(fakeApp({ ".cfg/plugins/p/data.json": '{"a":1}' }), settings, { ports, confirm });
    const report = await svc.applyInteractive(profile, "Codeblock note.md");
    expect(confirm.mock.calls[0]?.[1]).toEqual(["p"]);
    expect(writes).toEqual([".cfg/plugins/p/data.json"]);
    expect(prune).toHaveBeenCalledTimes(1);
    expect((prune.mock.calls[0] as unknown[])[2]).toEqual(DEFAULT_GFS_POLICY);
    expect((prune.mock.calls[0] as unknown[])[3]).toEqual(["snap"]); // M3: der eigene Schnappschuss ist geschützt
    expect("origin" in report && report.origin).toBe("Codeblock note.md");
    expect(Notice.instances[0]?.message).toContain("Codeblock note.md");
  });

  it("willReload nennt nur aktive Plugins, nicht installierte inaktive", async () => {
    const two: SettingsProfile = { ...profile, entries: [...profile.entries, { target: { kind: "plugin", id: "q" }, values: { a: 2 } }] };
    const app = fakeApp({ ".cfg/plugins/p/data.json": '{"a":1}', ".cfg/plugins/q/data.json": '{"a":1}' });
    const confirm = vi.fn(async (_rows: CheckRow[], _reload: string[]) => null);
    await new ApplyService(app, settings, { ports: fakePorts().ports, confirm }).applyInteractive(two, "x");
    expect(confirm.mock.calls[0]?.[1]).toEqual(["p"]);
  });

  it.each(["read", "confirm"])("Wurf in %s liefert { error }, Notice, Riegel gelöst", async (where) => {
    const files = { ".cfg/plugins/p/data.json": '{"a":1}' };
    const app = fakeApp(files) as { vault: { adapter: { read: (p: string) => Promise<string> } } };
    if (where === "read") app.vault.adapter.read = async () => { throw new Error("boom"); };
    const confirm = where === "confirm" ? async () => { throw new Error("boom"); } : async () => null;
    const svc = new ApplyService(app as never, settings, { ports: fakePorts().ports, confirm });
    expect(await svc.applyInteractive(profile, "x")).toEqual({ error: "boom" });
    expect(Notice.instances[0]?.message).toContain("boom");
    expect(svc.busy).toBe(false);
    expect(await svc.applyInteractive(profile, "y")).toEqual({ error: "boom" });
  });

  it("plan liefert die Prüfzeilen", async () => {
    const svc = new ApplyService(fakeApp({ ".cfg/plugins/p/data.json": '{"a":1}' }), settings);
    const rows = await svc.plan(profile);
    expect(rows.map((r) => r.status)).toEqual(["change"]);
  });
});

describe("formatReport", () => {
  it("enthält keine Werte geheimer Zeilen", () => {
    const secretRow: CheckRow = { target: { kind: "plugin", id: "p" }, path: ["apiKey"], status: "secret", checked: false, selectable: false, current: "TOPSECRET", desired: "TOPSECRET2" };
    const text = formatReport({ origin: "o", snapshotDir: "s", stopped: false, results: [{ row: secretRow, outcome: "skipped", actual: "TOPSECRET3" }] });
    expect(text).not.toContain("TOPSECRET");
    expect(text).toContain("apiKey");
  });
  it("(M10) corrected zeigt einen zurückgeschriebenen geheimen Teilbaum nur geschwärzt", () => {
    const row: CheckRow = { target: { kind: "plugin", id: "p" }, path: ["conn"], status: "change", checked: true, selectable: true, current: { url: "a" }, desired: { url: "b" } };
    const text = formatReport({ origin: "o", snapshotDir: "s", stopped: false, results: [{ row, outcome: "corrected", actual: { url: "b", apiKey: "sk-CORRECTED" } }] });
    expect(text).not.toContain("sk-CORRECTED");
    expect(text).toContain("🔒");
    expect(text).toContain('"url":"b"');
  });
});

describe("renderCheckRows", () => {
  const mk = (over: Partial<CheckRow>): CheckRow => ({ target: { kind: "plugin", id: "p" }, path: ["a"], status: "change", current: 1, desired: 2, checked: true, selectable: true, ...over });
  it("eine Zeile je CheckRow, Status als Text, Checkbox nur bei interactive+selectable", () => {
    const parent = makeFakeEl();
    const rows = [mk({}), mk({ path: ["b"], status: "same", selectable: false, checked: false }), mk({ path: ["k"], status: "secret", selectable: false, checked: false, current: undefined, desired: undefined })];
    renderCheckRows(parent, rows, { interactive: true, openPluginSettings: () => {} });
    expect(parent.querySelectorAll(".sa-row")).toHaveLength(3);
    const boxes = parent.querySelectorAll("input");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute("aria-label")).toBeTruthy();
    expect(parent.textContent).toContain("will change");
    expect(parent.querySelectorAll("button")).toHaveLength(1);
    const p2 = makeFakeEl();
    renderCheckRows(p2, rows, { interactive: false });
    expect(p2.querySelectorAll("input")).toHaveLength(0);
  });
  it("zeigt Ist → Soll, Begründung und nie Werte einer secret-Zeile", () => {
    const parent = makeFakeEl();
    renderCheckRows(parent, [mk({ note: "weil" }), mk({ status: "secret", current: "LEAK", desired: "LEAK", checked: false, selectable: false })], { interactive: false });
    expect(parent.textContent).toContain("1 → 2");
    expect(parent.textContent).toContain("Reason: weil");
    expect(parent.textContent).not.toContain("LEAK");
  });
  it("Toggle meldet Index und Zustand", () => {
    const parent = makeFakeEl();
    const onToggle = vi.fn();
    renderCheckRows(parent, [mk({})], { interactive: true, onToggle });
    const cb = parent.querySelectorAll("input")[0];
    cb.checked = false;
    cb._listeners["change"][0]();
    expect(onToggle).toHaveBeenCalledWith(0, false);
  });
});
