// src/core/apply-run.ts
import { applyRows } from "./patch";
import { parseTarget, type CheckRow } from "./reconcile";
import { hashText, restoreDecision, type SnapshotFile } from "./snapshot";
import { deepEqual, getAt, sameTarget, type Json, type Target } from "./types";
import { isWritable, targetPath } from "./write-policy";

export interface SnapshotHandle { dir: string; finish(files: SnapshotFile[]): Promise<void> }
export interface ApplyPorts {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  isEnabled(pluginId: string): boolean;
  disable(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  beginSnapshot(paths: string[], origin: string): Promise<SnapshotHandle>;
}
export type RowOutcome = "written" | "corrected" | "skipped" | "changed-meanwhile" | "error";
export interface RowResult { row: CheckRow; outcome: RowOutcome; actual?: Json; error?: string }
export interface ApplyReport { origin: string; snapshotDir: string | null; results: RowResult[]; stopped: boolean }

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Plugin aus → fn → Plugin an (im finally). Nur aktive Plugins, nie Obsidian-Dateien. */
async function withCycle<T>(target: Target, ports: ApplyPorts, fn: () => Promise<T>): Promise<T> {
  const cycle = target.kind === "plugin" && ports.isEnabled(target.id);
  if (cycle) await ports.disable((target as { id: string }).id);
  try { return await fn(); } finally { if (cycle) await ports.enable((target as { id: string }).id); }
}

function groupByTarget<T extends { target: Target }>(items: readonly T[]): Array<{ target: Target; items: T[] }> {
  const groups: Array<{ target: Target; items: T[] }> = [];
  for (const it of items) {
    const g = groups.find((x) => sameTarget(x.target, it.target));
    if (g) g.items.push(it); else groups.push({ target: it.target, items: [it] });
  }
  return groups;
}

export async function runApply(rows: readonly CheckRow[], ports: ApplyPorts, opts: { configDir: string; origin: string }): Promise<ApplyReport> {
  const chosen = rows.filter((r) => r.checked && r.selectable);
  // Zweite Prüfung neben `reconcile`: ein nicht schreibbares Ziel kommt weder in den Schnappschuss noch an `write`.
  const selected = chosen.filter((r) => isWritable(r.target));
  const blocked = chosen.filter((r) => !isWritable(r.target));
  const groups = groupByTarget(selected);
  const paths = groups.map((g) => targetPath(g.target, opts.configDir));
  const results: RowResult[] = [];
  const existedBefore = new Map<string, boolean>();
  for (const p of paths) existedBefore.set(p, (await ports.read(p)) !== null);

  let handle: SnapshotHandle;
  try { handle = await ports.beginSnapshot(paths, opts.origin); } catch (e) {
    return { origin: opts.origin, snapshotDir: null, results: [...selected.map((row): RowResult => ({ row, outcome: "error", error: `snapshot: ${errText(e)}` })), ...blocked.map((row): RowResult => ({ row, outcome: "skipped" }))], stopped: true };
  }

  const finished: SnapshotFile[] = [];
  let stopped = false;
  for (const [i, g] of groups.entries()) {
    const path = paths[i];
    if (stopped) { for (const row of g.items) results.push({ row, outcome: "skipped" }); continue; }
    try {
      const written = await withCycle(g.target, ports, async () => {
        const text = await ports.read(path);
        const parsed = parseTarget(text);
        if (!parsed.ok) throw new Error("unreadable");
        const drifted = g.items.some((row) => !deepEqual(getAt(parsed.content, row.path), row.current));
        if (drifted) return null;
        const next = applyRows(text, g.items.map((row) => ({ path: row.path, desired: row.desired as Json })));
        await ports.write(path, next);
        return next;
      });
      if (written === null) { for (const row of g.items) results.push({ row, outcome: "changed-meanwhile" }); continue; }
      const after = await ports.read(path);
      finished.push({ path, existed: existedBefore.get(path) ?? false, afterHash: after === null ? null : hashText(after) });
      const back = parseTarget(after);
      for (const row of g.items) {
        const actual = back.ok ? getAt(back.content, row.path) : undefined;
        if (deepEqual(actual, row.desired)) results.push({ row, outcome: "written" });
        else results.push({ row, outcome: "corrected", ...(actual !== undefined ? { actual } : {}) });
      }
    } catch (e) {
      for (const row of g.items) results.push({ row, outcome: "error", error: errText(e) });
      let afterHash: string | null = null;
      try { const after = await ports.read(path); afterHash = after === null ? null : hashText(after); } catch { afterHash = null; }
      finished.push({ path, existed: existedBefore.get(path) ?? false, afterHash });
      stopped = true;
    }
  }
  await handle.finish(finished);
  for (const row of blocked) results.push({ row, outcome: "skipped" });
  return { origin: opts.origin, snapshotDir: handle.dir, results, stopped };
}

export interface RestoreItem { target: Target; file: SnapshotFile; savedText: string | null }
/** `skipped`: nach einem Fehler nicht mehr angefasst (der Lauf stoppt, kein automatisches Zurückrollen). */
export interface RestoreResult { path: string; outcome: "restored" | "changed-since" | "unverified" | "error" | "skipped"; error?: string }

/** Spec § 7 „Zurückholen“: derselbe Weg, Schnappschuss als Quelle; ein seither geänderter Stand bleibt, außer er ist in `force`. */
export async function runRestore(items: readonly RestoreItem[], force: ReadonlySet<string>, ports: ApplyPorts, opts: { origin: string }): Promise<{ snapshotDir: string | null; results: RestoreResult[] }> {
  const results: RestoreResult[] = [];
  const todo: RestoreItem[] = [];
  for (const it of items) {
    const decision = restoreDecision(it.file, await ports.read(it.file.path));
    if (decision === "restore" || force.has(it.file.path)) todo.push(it);
    else results.push({ path: it.file.path, outcome: decision === "changed" ? "changed-since" : "unverified" });
  }
  if (todo.length === 0) return { snapshotDir: null, results };
  let handle: SnapshotHandle;
  try { handle = await ports.beginSnapshot(todo.map((t) => t.file.path), opts.origin); } catch (e) {
    return { snapshotDir: null, results: [...results, ...todo.map((t) => ({ path: t.file.path, outcome: "error" as const, error: `snapshot: ${errText(e)}` }))] };
  }
  const finished: SnapshotFile[] = [];
  for (const [i, it] of todo.entries()) {
    try {
      const existed = (await ports.read(it.file.path)) !== null;
      await withCycle(it.target, ports, async () => {
        if (it.savedText === null) await ports.remove(it.file.path);
        else await ports.write(it.file.path, it.savedText);
      });
      const after = await ports.read(it.file.path);
      finished.push({ path: it.file.path, existed, afterHash: after === null ? null : hashText(after) });
      results.push({ path: it.file.path, outcome: "restored" });
    } catch (e) {
      results.push({ path: it.file.path, outcome: "error", error: errText(e) });
      // Die übrigen Dateien erscheinen im Bericht, statt stillschweigend zu fehlen.
      for (const rest of todo.slice(i + 1)) results.push({ path: rest.file.path, outcome: "skipped" });
      break;
    }
  }
  await handle.finish(finished);
  return { snapshotDir: handle.dir, results };
}
