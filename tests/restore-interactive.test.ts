import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { Notice } from "./vendor/kit/obsidian-mock";
import { hashText } from "../src/core/snapshot";
import type { ApplyPorts, RestoreItem } from "../src/core/apply-run";
import { DEFAULT_GFS_POLICY } from "../src/vendor/kit/rotation";

const prune = vi.fn(async () => [] as string[]);
const load = vi.fn(async (_app: unknown, _dir: string): Promise<RestoreItem[]> => []);
vi.mock("../src/obsidian/snapshots", async (orig) => ({
  ...(await orig<typeof import("../src/obsidian/snapshots")>()),
  pruneSnapshots: (...a: unknown[]) => (prune as (...x: unknown[]) => Promise<string[]>)(...a),
  loadRestoreItems: (a: unknown, d: string) => load(a, d),
}));

import { ApplyService, type RestoreRow } from "../src/obsidian/apply-service";

const A = ".cfg/hotkeys.json";
const B = ".cfg/plugins/p/data.json";
const item = (path: string, target: RestoreItem["target"], afterText: string | null, savedText: string | null): RestoreItem => ({
  target, savedText, file: { path, existed: savedText !== null, afterHash: afterText === null ? null : hashText(afterText) },
});
const itemA = item(A, { kind: "obsidian", file: "hotkeys" }, "[1]", "[0]");
const itemB = item(B, { kind: "plugin", id: "p" }, '{"a":2}', '{"a":1}');

function setup(files: Record<string, string>) {
  const writes: string[] = [];
  const ports: ApplyPorts = {
    read: async (p) => files[p] ?? null,
    write: async (p, t) => { files[p] = t; writes.push(p); },
    remove: async () => {},
    isEnabled: () => false, disable: async () => {}, enable: async () => {},
    beginSnapshot: async () => ({ dir: "safety", finish: async () => {} }),
  };
  return { ports, writes };
}
const app = { vault: { configDir: ".cfg" } } as never;
const settings = () => ({ retention: DEFAULT_GFS_POLICY });
beforeEach(() => { prune.mockClear(); load.mockReset(); Notice.instances.length = 0; });

describe("ApplyService.restoreInteractive", () => {
  it("Dialogzeilen: unveränderte Datei angehakt, geänderte und ungeprüfte nicht", async () => {
    load.mockResolvedValue([itemA, itemB, item(".cfg/appearance.json", { kind: "obsidian", file: "appearance" }, null, "{}")]);
    const { ports } = setup({ [A]: "[1]", [B]: '{"a":99}', ".cfg/appearance.json": "{}" });
    const confirmRestore = vi.fn(async (_rows: RestoreRow[]) => null);
    await new ApplyService(app, settings, { ports, confirmRestore }).restoreInteractive("d");
    const rows = confirmRestore.mock.calls[0]?.[0] ?? [];
    expect(rows.map((r) => [r.path, r.decision, r.checked])).toEqual([[A, "restore", true], [B, "changed", false], [".cfg/appearance.json", "unverified", false]]);
  });

  it("(M4) während ein anderer Lauf offen ist: { busy: true } und eine Notice", async () => {
    load.mockResolvedValue([itemA]);
    const { ports, writes } = setup({ [A]: "[1]" });
    let release: (v: Set<string> | null) => void = () => {};
    const svc = new ApplyService(app, settings, { ports, confirmRestore: () => new Promise((r) => { release = r; }) });
    const first = svc.restoreInteractive("d");
    await vi.waitFor(() => { expect(svc.busy).toBe(true); });
    expect(await svc.restoreInteractive("d")).toEqual({ busy: true });
    expect(Notice.instances.map((n) => n.message)).toContain("Another change is running — try again in a moment.");
    release(null);
    await first;
    expect(writes).toEqual([]);
  });

  it("Abbruch schreibt nichts", async () => {
    load.mockResolvedValue([itemA]);
    const { ports, writes } = setup({ [A]: "[1]" });
    const svc = new ApplyService(app, settings, { ports, confirmRestore: async () => null });
    expect(await svc.restoreInteractive("d")).toEqual({ cancelled: true });
    expect(writes).toEqual([]);
    expect(prune).not.toHaveBeenCalled();
    expect(svc.busy).toBe(false);
  });

  it("zweiter Aufruf während eines laufenden liefert busy", async () => {
    load.mockResolvedValue([itemA]);
    const { ports } = setup({ [A]: "[1]" });
    let release: (v: Set<string> | null) => void = () => {};
    const svc = new ApplyService(app, settings, { ports, confirmRestore: () => new Promise((r) => { release = r; }) });
    const first = svc.restoreInteractive("d");
    await vi.waitFor(() => expect(svc.busy).toBe(true));
    expect(await svc.restoreInteractive("d2")).toEqual({ busy: true });
    release(null);
    await first;
    expect(svc.busy).toBe(false);
  });

  it("geänderte Datei bleibt ohne force, die unveränderte wird zurückgeholt; Bericht und Prune", async () => {
    load.mockResolvedValue([itemA, itemB]);
    const files: Record<string, string> = { [A]: "[1]", [B]: '{"a":99}' };
    const { ports, writes } = setup(files);
    const svc = new ApplyService(app, settings, { ports, confirmRestore: async (rows) => new Set(rows.filter((r) => r.checked).map((r) => r.path)) });
    const report = await svc.restoreInteractive("2026-10-03T10-00-00");
    expect(writes).toEqual([A]);
    expect(files[A]).toBe("[0]");
    expect(files[B]).toBe('{"a":99}');
    expect("results" in report && report.results.map((r) => r.outcome)).toEqual(["changed-since", "restored"]);
    expect(prune).toHaveBeenCalledTimes(1);
    expect((prune.mock.calls[0] as unknown[])[3]).toEqual(["safety"]); // M3
    expect(Notice.instances[0]?.message).toContain("restore:2026-10-03T10-00-00");
    expect(Notice.instances[0]?.message).toContain("changed since");
  });

  it("force (angehakte geänderte Datei) überschreibt", async () => {
    load.mockResolvedValue([itemB]);
    const files: Record<string, string> = { [B]: '{"a":99}' };
    const { ports, writes } = setup(files);
    const svc = new ApplyService(app, settings, { ports, confirmRestore: async () => new Set([B]) });
    await svc.restoreInteractive("d");
    expect(writes).toEqual([B]);
    expect(files[B]).toBe('{"a":1}');
  });

  it("abgewählte Zeile wird nicht angefasst", async () => {
    load.mockResolvedValue([itemA]);
    const { ports, writes } = setup({ [A]: "[1]" });
    const svc = new ApplyService(app, settings, { ports, confirmRestore: async () => new Set<string>() });
    expect(await svc.restoreInteractive("d")).toEqual({ cancelled: true });
    expect(writes).toEqual([]);
  });

  it("leerer Schnappschuss: Notice, kein Dialog", async () => {
    load.mockResolvedValue([]);
    const confirmRestore = vi.fn(async () => null);
    const svc = new ApplyService(app, settings, { ports: setup({}).ports, confirmRestore });
    expect(await svc.restoreInteractive("d")).toEqual({ cancelled: true });
    expect(confirmRestore).not.toHaveBeenCalled();
    expect(Notice.instances[0]?.message).toBe("Nothing to restore from this snapshot.");
  });

  it("Fehlerpfad: Wurf liefert { error }, Notice nur mit Message, Riegel gelöst", async () => {
    load.mockRejectedValue(new Error("boom"));
    const svc = new ApplyService(app, settings, { ports: setup({}).ports, confirmRestore: async () => null });
    expect(await svc.restoreInteractive("d")).toEqual({ error: "boom" });
    expect(Notice.instances[0]?.message).toContain("boom");
    expect(svc.busy).toBe(false);
  });
});
