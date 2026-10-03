// uebernommen aus obsidian-transmute/src/obsidian/snapshot-io.ts, 2026-10-03
// Angepasst: Manifest mit `version`/`origin`/`existed`, Konfig-Dateien über `vault.adapter` (keine TFile),
// fehlende Dateien sind `existed: false`, Rotation über GFS (Kit `rotation`), Ordnerkollision -2/-3.
import type { App } from "obsidian";
import type { ApplyPorts, RestoreItem, SnapshotHandle } from "../core/apply-run";
import { snapshotDirName, type SnapshotFile, type SnapshotManifest } from "../core/snapshot";
import { isValidPluginId } from "../core/profile";
import { isWritable, SELF_PLUGIN_ID, targetPath } from "../core/write-policy";
import { OBSIDIAN_FILES, type ObsidianFile, type Target } from "../core/types";
import { selectGfsRetention, type GfsPolicy } from "../vendor/kit/rotation";
import { ensureDir, readConfig, removeConfig, writeConfig } from "./config-io";
import { disablePlugin, enablePlugin, isPluginEnabled } from "./plugin-host";

/** `configDir` statt hartkodiertem Ordnernamen — der Pfad ist konfigurierbar. */
export function snapshotRoot(app: App): string {
  return `${app.vault.configDir}/plugins/settings-assistant/snapshots`;
}

async function writeManifest(app: App, dir: string, manifest: SnapshotManifest): Promise<void> {
  await app.vault.adapter.write(`${snapshotRoot(app)}/${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
}

async function freeDirName(app: App, base: string): Promise<string> {
  let name = base;
  for (let n = 2; await app.vault.adapter.exists(`${snapshotRoot(app)}/${name}`); n++) name = `${base}-${n}`;
  return name;
}

/**
 * Sichert die betroffenen Dateien und legt das Manifest an — VOR der ersten Änderung, mit `afterHash: null`.
 * Wirft, wenn gesichert nicht werden kann; dann wird nichts geschrieben.
 */
export async function beginSnapshot(app: App, paths: string[], origin: string): Promise<SnapshotHandle> {
  const at = new Date().toISOString();
  const dir = await freeDirName(app, snapshotDirName(at));
  const root = `${snapshotRoot(app)}/${dir}`;
  await ensureDir(app, `${root}/files`);
  const files: SnapshotFile[] = [];
  for (const path of paths) {
    const text = await readConfig(app, path);
    if (text !== null) {
      const target = `${root}/files/${path}`;
      await ensureDir(app, target.slice(0, target.lastIndexOf("/")));
      await app.vault.adapter.write(target, text);
    }
    files.push({ path, existed: text !== null, afterHash: null });
  }
  const manifest: SnapshotManifest = { version: 1, at, origin, files };
  await writeManifest(app, dir, manifest);
  return {
    dir,
    async finish(done: SnapshotFile[]): Promise<void> {
      const byPath = new Map(done.map((f) => [f.path, f]));
      // `existed` bleibt der Stand vor dem Lauf; nachgetragen wird nur der Hash.
      manifest.files = manifest.files.map((f) => {
        const d = byPath.get(f.path);
        return d ? { ...f, afterHash: d.afterHash } : f;
      });
      await writeManifest(app, dir, manifest);
    },
  };
}

async function readManifest(app: App, dir: string): Promise<SnapshotManifest | null> {
  try {
    const m = JSON.parse(await app.vault.adapter.read(`${snapshotRoot(app)}/${dir}/manifest.json`)) as SnapshotManifest;
    const ok = !!m && m.version === 1 && typeof m.at === "string" && Array.isArray(m.files) &&
      m.files.every((f) => typeof f === "object" && f !== null && typeof f.path === "string" &&
        typeof f.existed === "boolean" && (f.afterHash === null || typeof f.afterHash === "string"));
    return ok ? m : null;
  } catch {
    return null;
  }
}

/** Neueste zuerst. Unlesbare Manifeste werden übersprungen, nie gelöscht. */
export async function listSnapshots(app: App): Promise<Array<{ dir: string; manifest: SnapshotManifest }>> {
  const root = snapshotRoot(app);
  if (!(await app.vault.adapter.exists(root))) return [];
  const listing = await app.vault.adapter.list(root);
  const out: Array<{ dir: string; manifest: SnapshotManifest }> = [];
  for (const folder of listing.folders) {
    const dir = folder.slice(root.length + 1);
    const manifest = await readManifest(app, dir);
    if (manifest) out.push({ dir, manifest });
  }
  return out.sort((a, b) => (a.manifest.at < b.manifest.at ? 1 : a.manifest.at > b.manifest.at ? -1 : a.dir < b.dir ? 1 : -1));
}

function targetFromPath(configDir: string, path: string): Target | null {
  const plugin = new RegExp(`^${configDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/plugins/([^/]+)/data\\.json$`).exec(path);
  if (plugin?.[1]) return isValidPluginId(plugin[1]) && plugin[1] !== SELF_PLUGIN_ID ? { kind: "plugin", id: plugin[1] } : null;
  const file = path.startsWith(`${configDir}/`) ? path.slice(configDir.length + 1).replace(/\.json$/, "") : "";
  return (OBSIDIAN_FILES as readonly string[]).includes(file) ? { kind: "obsidian", file: file as ObsidianFile } : null;
}

export async function loadRestoreItems(app: App, dir: string): Promise<RestoreItem[]> {
  const manifest = await readManifest(app, dir);
  if (!manifest) return [];
  const items: RestoreItem[] = [];
  for (const file of manifest.files) {
    const target = targetFromPath(app.vault.configDir, file.path);
    // Das Manifest ist Dateiinhalt, also Eingabe: der Pfad muss exakt aus dem Target rückrechenbar sein.
    if (!target || !isWritable(target) || targetPath(target, app.vault.configDir) !== file.path) continue;
    const savedText = file.existed ? await app.vault.adapter.read(`${snapshotRoot(app)}/${dir}/files/${file.path}`) : null;
    items.push({ target, file, savedText });
  }
  return items;
}

/** Löscht, was die GFS-Auswahl nennt (nie `future`); nicht lesbare Manifeste sind nicht im Eingang und bleiben. */
export async function pruneSnapshots(app: App, now: number, policy: GfsPolicy): Promise<string[]> {
  const all = await listSnapshots(app);
  const entries = all.map((s) => ({ name: s.dir, time: Date.parse(s.manifest.at) })).filter((e) => Number.isFinite(e.time));
  const { drop } = selectGfsRetention(entries, now, { policy });
  const root = snapshotRoot(app);
  for (const name of drop) await app.vault.adapter.rmdir(`${root}/${name}`, true);
  return drop;
}

export function makePorts(app: App): ApplyPorts {
  // hotkeys.json wird wie jede andere Datei geschrieben: gemessen (Task 1) wirkt sie über vault.adapter ohne Neustart.
  return {
    read: (path) => readConfig(app, path),
    write: (path, text) => writeConfig(app, path, text),
    remove: (path) => removeConfig(app, path),
    isEnabled: (id) => isPluginEnabled(app, id),
    disable: (id) => disablePlugin(app, id),
    enable: (id) => enablePlugin(app, id),
    beginSnapshot: (paths, origin) => beginSnapshot(app, paths, origin),
  };
}
