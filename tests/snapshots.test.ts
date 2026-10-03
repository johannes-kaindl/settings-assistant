import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashText } from "../src/core/snapshot";
import { DEFAULT_GFS_POLICY } from "../src/vendor/kit/rotation";
import { beginSnapshot, listSnapshots, loadRestoreItems, makePorts, pickUndoTarget, pruneSnapshots, snapshotRoot } from "../src/obsidian/snapshots";

function fakeApp(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const dirs = new Set<string>();
  const adapter = {
    exists: async (p: string) => files.has(p) || dirs.has(p),
    read: async (p: string) => { const t = files.get(p); if (t === undefined) throw new Error(`ENOENT ${p}`); return t; },
    write: async (p: string, t: string) => { files.set(p, t); },
    mkdir: async (p: string) => { dirs.add(p); },
    remove: async (p: string) => { files.delete(p); },
    rmdir: async (p: string) => {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
    },
    list: async (p: string) => {
      const sub = new Set<string>();
      for (const k of [...files.keys(), ...dirs]) if (k.startsWith(`${p}/`)) sub.add(`${p}/${k.slice(p.length + 1).split("/")[0]}`);
      return { files: [] as string[], folders: [...sub].filter((s) => !files.has(s)) };
    },
  };
  const app = { vault: { configDir: ".cfg", adapter } } as never;
  return { app, files, dirs };
}

const DATA = ".cfg/plugins/foo/data.json";
const HK = ".cfg/hotkeys.json";

describe("snapshots", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T14:05:12.345Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("(a)(b) copies existing files and writes the manifest with afterHash null first; missing file is existed:false", async () => {
    const { app, files } = fakeApp({ [DATA]: '{"a":1}' });
    const h = await beginSnapshot(app, [DATA, HK], "api:test");
    const root = `${snapshotRoot(app)}/${h.dir}`;
    expect(files.get(`${root}/files/${DATA}`)).toBe('{"a":1}');
    expect(files.has(`${root}/files/${HK}`)).toBe(false);
    const m = JSON.parse(files.get(`${root}/manifest.json`) ?? "");
    expect(m.version).toBe(1);
    expect(m.origin).toBe("api:test");
    expect(m.files).toEqual([
      { path: DATA, existed: true, afterHash: null },
      { path: HK, existed: false, afterHash: null },
    ]);
  });

  it("(c) finish writes the hashes", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    const h = await beginSnapshot(app, [DATA], "api:test");
    await h.finish([{ path: DATA, existed: true, afterHash: hashText("new") }]);
    const m = JSON.parse(files.get(`${snapshotRoot(app)}/${h.dir}/manifest.json`) ?? "");
    expect(m.files[0].afterHash).toBe(hashText("new"));
  });

  it("same-second collision gets -2, -3", async () => {
    const { app } = fakeApp({ [DATA]: "{}" });
    const a = await beginSnapshot(app, [DATA], "o");
    const b = await beginSnapshot(app, [DATA], "o");
    const c = await beginSnapshot(app, [DATA], "o");
    expect(a.dir).toBe("2026-10-03T14-05-12");
    expect(b.dir).toBe("2026-10-03T14-05-12-2");
    expect(c.dir).toBe("2026-10-03T14-05-12-3");
  });

  it("(d) listSnapshots skips a broken manifest, never deletes it, newest first", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    const a = await beginSnapshot(app, [DATA], "o");
    vi.setSystemTime(new Date("2026-10-03T15:00:00Z"));
    const b = await beginSnapshot(app, [DATA], "o");
    const bad = `${snapshotRoot(app)}/2026-10-03T16-00-00`;
    files.set(`${bad}/manifest.json`, "{nope");
    const list = await listSnapshots(app);
    expect(list.map((x) => x.dir)).toEqual([b.dir, a.dir]);
    expect(files.has(`${bad}/manifest.json`)).toBe(true);
    await pruneSnapshots(app, Date.parse("2026-10-03T17:00:00Z"), { today: 0, days: 0, weeks: 0, months: 0 });
    expect(files.has(`${bad}/manifest.json`)).toBe(true);
  });

  it("(e) prune drops exactly what GFS names, never future", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    vi.setSystemTime(new Date("2026-01-01T10:00:00Z")); const old = await beginSnapshot(app, [DATA], "o");
    vi.setSystemTime(new Date("2026-10-03T10:00:00Z")); const cur = await beginSnapshot(app, [DATA], "o");
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z")); const fut = await beginSnapshot(app, [DATA], "o");
    const now = Date.parse("2026-10-03T12:00:00Z");
    const dropped = await pruneSnapshots(app, now, { ...DEFAULT_GFS_POLICY, months: 1 });
    expect(dropped).toEqual([old.dir]);
    expect(files.has(`${snapshotRoot(app)}/${old.dir}/manifest.json`)).toBe(false);
    expect(files.has(`${snapshotRoot(app)}/${cur.dir}/manifest.json`)).toBe(true);
    expect(files.has(`${snapshotRoot(app)}/${fut.dir}/manifest.json`)).toBe(true);
    // even with a policy keeping nothing, the future entry survives
    await pruneSnapshots(app, now, { today: 0, days: 0, weeks: 0, months: 0 });
    expect(files.has(`${snapshotRoot(app)}/${fut.dir}/manifest.json`)).toBe(true);
  });

  it("(M3) prune löscht den geschützten, gerade angelegten Schnappschuss nie — auch bei Aufbewahrung 0/0/0/0", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    vi.setSystemTime(new Date("2026-10-03T10:00:00Z")); const older = await beginSnapshot(app, [DATA], "o");
    vi.setSystemTime(new Date("2026-10-03T11:00:00Z")); const fresh = await beginSnapshot(app, [DATA], "o");
    const dropped = await pruneSnapshots(app, Date.parse("2026-10-03T12:00:00Z"), { today: 0, days: 0, weeks: 0, months: 0 }, [fresh.dir]);
    expect(dropped).toEqual([older.dir]);
    expect(files.has(`${snapshotRoot(app)}/${fresh.dir}/manifest.json`)).toBe(true);
  });

  it("(f) loadRestoreItems: savedText null for existed:false, targets derived from path", async () => {
    const { app } = fakeApp({ [DATA]: '{"a":1}' });
    const h = await beginSnapshot(app, [DATA, HK], "o");
    const items = await loadRestoreItems(app, h.dir);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ target: { kind: "plugin", id: "foo" }, savedText: '{"a":1}' });
    expect(items[1]).toMatchObject({ target: { kind: "obsidian", file: "hotkeys" }, savedText: null });
  });

  it("loadRestoreItems drops manifest paths that do not map back to a writable target", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    const h = await beginSnapshot(app, [DATA], "o");
    const mp = `${snapshotRoot(app)}/${h.dir}/manifest.json`;
    const m = JSON.parse(files.get(mp) ?? "");
    const bad = [".cfg/plugins/../data.json", ".cfg/plugins/a b/data.json", ".cfg/plugins/settings-assistant/data.json", "../../x", "/etc/passwd"];
    m.files = [...bad.map((path) => ({ path, existed: false, afterHash: null })), ...m.files];
    files.set(mp, JSON.stringify(m));
    const items = await loadRestoreItems(app, h.dir);
    expect(items.map((i) => i.file.path)).toEqual([DATA]);
  });

  it("readManifest treats malformed file entries as unreadable", async () => {
    const { app, files } = fakeApp({ [DATA]: "{}" });
    const h = await beginSnapshot(app, [DATA], "o");
    const mp = `${snapshotRoot(app)}/${h.dir}/manifest.json`;
    const m = JSON.parse(files.get(mp) ?? "");
    m.files = [{ path: DATA, existed: "yes", afterHash: null }];
    files.set(mp, JSON.stringify(m));
    expect(await listSnapshots(app)).toEqual([]);
    m.files = [null];
    files.set(mp, JSON.stringify(m));
    expect(await listSnapshots(app)).toEqual([]);
  });

  it("makePorts wires read/write/remove with directory creation", async () => {
    const { app, files } = fakeApp();
    const ports = makePorts(app);
    expect(await ports.read(DATA)).toBeNull();
    await ports.write(DATA, "{}");
    expect(files.get(DATA)).toBe("{}");
    await ports.remove(DATA);
    expect(files.has(DATA)).toBe(false);
  });
});

describe("pickUndoTarget", () => {
  const e = (dir: string, origin: string) => ({ dir, manifest: { origin } });
  it("nimmt den neuesten Nicht-restore-Eintrag", () => {
    expect(pickUndoTarget([e("c", "restore:b"), e("b", "profile:x"), e("a", "profile:y")])?.dir).toBe("b");
  });
  it("leere oder nur-restore-Liste: null", () => {
    expect(pickUndoTarget([])).toBeNull();
    expect(pickUndoTarget([e("a", "restore:z")])).toBeNull();
  });
});
