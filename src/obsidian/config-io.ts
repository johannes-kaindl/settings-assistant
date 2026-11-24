import type { App } from "obsidian";
import { isInstalled } from "./plugin-host";
import type { TargetState } from "../core/reconcile";
import type { Target } from "../core/types";
import { targetPath } from "../core/write-policy";
import { ensureDir } from "../vendor/kit/ensure-dir";

export async function readConfig(app: App, path: string): Promise<string | null> {
  return (await app.vault.adapter.exists(path)) ? app.vault.adapter.read(path) : null;
}

export async function writeConfig(app: App, path: string, text: string): Promise<void> {
  await ensureDir(app.vault.adapter, path.slice(0, Math.max(0, path.lastIndexOf("/"))));
  await app.vault.adapter.write(path, text);
}

export async function removeConfig(app: App, path: string): Promise<void> {
  if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
}

export async function readTargetStates(app: App, targets: Target[]): Promise<TargetState[]> {
  return Promise.all(
    targets.map(async (target) => ({
      target,
      installed: target.kind === "obsidian" || isInstalled(app, target.id),
      text: await readConfig(app, targetPath(target, app.vault.configDir)),
    })),
  );
}
