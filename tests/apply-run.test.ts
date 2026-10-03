// tests/apply-run.test.ts
import { describe, expect, it } from "vitest";
import { parseProfile } from "../src/core/profile";
import { reconcile } from "../src/core/reconcile";
import { runApply, runRestore, type ApplyPorts } from "../src/core/apply-run";
import { hashText, type SnapshotFile } from "../src/core/snapshot";

const DIR = ".obs";
const P = `${DIR}/plugins/koda-agent/data.json`;

function fakePorts(files: Record<string, string>, opts: { onDisable?: (f: Record<string, string>) => void; onEnable?: (f: Record<string, string>) => void; enabled?: boolean; failSnapshot?: boolean } = {}) {
  const log: string[] = [];
  let finished: SnapshotFile[] | null = null;
  const ports: ApplyPorts = {
    read: async (p) => files[p] ?? null,
    write: async (p, t) => { log.push(`write ${p}`); files[p] = t; },
    remove: async (p) => { log.push(`remove ${p}`); delete files[p]; },
    isEnabled: () => opts.enabled ?? true,
    disable: async (id) => { log.push(`disable ${id}`); opts.onDisable?.(files); },
    enable: async (id) => { log.push(`enable ${id}`); opts.onEnable?.(files); },
    beginSnapshot: async (paths) => {
      if (opts.failSnapshot) throw new Error("disk full");
      log.push(`snapshot ${paths.join(",")}`);
      return { dir: "2026-10-03T14-00-00", finish: async (f) => { finished = f; } };
    },
  };
  return { ports, log, files, finished: () => finished };
}

const rowsFor = (text: string, values: object) => {
  const r = parseProfile(JSON.stringify({ version: 1, plugins: { "koda-agent": values } }));
  if (!r.ok) throw new Error();
  return reconcile(r.profile, [{ target: { kind: "plugin", id: "koda-agent" }, installed: true, text }]);
};

describe("runApply", () => {
  it("snapshot → disable → write → enable → read back", async () => {
    const f = fakePorts({ [P]: '{"maxRounds":50}' });
    const rep = await runApply(rowsFor('{"maxRounds":50}', { maxRounds: 20 }), f.ports, { configDir: DIR, origin: "note:x.md" });
    expect(f.log).toEqual([`snapshot ${P}`, "disable koda-agent", `write ${P}`, "enable koda-agent"]);
    expect(rep.results.map((r) => r.outcome)).toEqual(["written"]);
    expect(f.files[P]).toBe('{"maxRounds":20}');
    expect(f.finished()).toEqual([{ path: P, existed: true, afterHash: hashText('{"maxRounds":20}') }]);
  });
  it("does not toggle a disabled plugin", async () => {
    const f = fakePorts({ [P]: '{"a":1}' }, { enabled: false });
    await runApply(rowsFor('{"a":1}', { a: 2 }), f.ports, { configDir: DIR, origin: "o" });
    expect(f.log).toEqual([`snapshot ${P}`, `write ${P}`]);
  });
  it("changed-meanwhile: plugin saved on disable → file untouched, plugin re-enabled", async () => {
    const f = fakePorts({ [P]: '{"maxRounds":50}' }, { onDisable: (fs) => { fs[P] = '{"maxRounds":60}'; } });
    const rep = await runApply(rowsFor('{"maxRounds":50}', { maxRounds: 20 }), f.ports, { configDir: DIR, origin: "o" });
    expect(rep.results[0]!.outcome).toBe("changed-meanwhile");
    expect(f.files[P]).toBe('{"maxRounds":60}');
    expect(f.log).toContain("enable koda-agent");
    expect(f.log.some((l) => l.startsWith("write"))).toBe(false);
  });
  it("corrected: plugin clamps the value on load → report the real value", async () => {
    const f = fakePorts({ [P]: '{"maxRounds":50}' }, { onEnable: (fs) => { fs[P] = '{"maxRounds":100}'; } });
    const rep = await runApply(rowsFor('{"maxRounds":50}', { maxRounds: 500 }), f.ports, { configDir: DIR, origin: "o" });
    expect(rep.results[0]).toMatchObject({ outcome: "corrected", actual: 100 });
  });
  it("snapshot failure writes nothing", async () => {
    const f = fakePorts({ [P]: '{"a":1}' }, { failSnapshot: true });
    const rep = await runApply(rowsFor('{"a":1}', { a: 2 }), f.ports, { configDir: DIR, origin: "o" });
    expect(rep.results.map((r) => r.outcome)).toEqual(["error"]);
    expect(f.log).toEqual([]);
    expect(rep.snapshotDir).toBeNull();
  });
  it("a missing data.json is created and recorded as not existed", async () => {
    const f = fakePorts({});
    const rows = rowsFor("{}", { a: 1 }).map((r) => ({ ...r, checked: true }));
    // reconcile sah eine leere Datei; der Port hat keine → beim erneuten Lesen ist der Ist-Wert weiter undefined
    const rep = await runApply(rows, f.ports, { configDir: DIR, origin: "o" });
    expect(rep.results[0]!.outcome).toBe("written");
    expect(f.finished()![0]!.existed).toBe(false);
  });
  it("stops after an error and skips the rest, enable still runs", async () => {
    const Q = `${DIR}/plugins/b/data.json`;
    const f = fakePorts({ [P]: '{"llm":"x"}', [Q]: '{"a":1}' });
    const r = parseProfile(JSON.stringify({ version: 1, plugins: { "koda-agent": { k: 1 }, b: { a: 2 } } }));
    if (!r.ok) throw new Error();
    const rows = reconcile(r.profile, [
      { target: { kind: "plugin", id: "koda-agent" }, installed: true, text: '{"k":0}' },
      { target: { kind: "plugin", id: "b" }, installed: true, text: '{"a":1}' },
    ]);
    f.files[P] = "{oops"; // zwischen Dialog und Schreiben unlesbar geworden
    const rep = await runApply(rows, f.ports, { configDir: DIR, origin: "o" });
    expect(rep.results.map((x) => x.outcome)).toEqual(["error", "skipped"]);
    expect(rep.stopped).toBe(true);
    expect(f.log).toContain("enable koda-agent");
  });
});

describe("runRestore", () => {
  it("restores an untouched file through the same plugin cycle", async () => {
    const f = fakePorts({ [P]: '{"a":2}' });
    const res = await runRestore([{ target: { kind: "plugin", id: "koda-agent" }, file: { path: P, existed: true, afterHash: hashText('{"a":2}') }, savedText: '{"a":1}' }], new Set(), f.ports, { origin: "restore:d" });
    expect(res.results[0]!.outcome).toBe("restored");
    expect(f.files[P]).toBe('{"a":1}');
    expect(f.log).toEqual([`snapshot ${P}`, "disable koda-agent", `write ${P}`, "enable koda-agent"]);
  });
  it("leaves a file edited since alone unless forced", async () => {
    const f = fakePorts({ [P]: '{"a":3}' });
    const item = { target: { kind: "plugin", id: "koda-agent" } as const, file: { path: P, existed: true, afterHash: hashText('{"a":2}') }, savedText: '{"a":1}' };
    expect((await runRestore([item], new Set(), f.ports, { origin: "o" })).results[0]!.outcome).toBe("changed-since");
    expect(f.files[P]).toBe('{"a":3}');
    expect((await runRestore([item], new Set([P]), f.ports, { origin: "o" })).results[0]!.outcome).toBe("restored");
  });
  it("removes a file that did not exist before", async () => {
    const f = fakePorts({ [P]: '{"a":1}' });
    await runRestore([{ target: { kind: "plugin", id: "koda-agent" }, file: { path: P, existed: false, afterHash: hashText('{"a":1}') }, savedText: null }], new Set(), f.ports, { origin: "o" });
    expect(f.files[P]).toBeUndefined();
  });
});
