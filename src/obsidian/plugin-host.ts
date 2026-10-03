// uebernommen aus anysource-sideloader/src/obsidian/installer.ts (PluginManager, pluginManager), 2026-10-03
// Angepasst: „aktiv“ = geladen ODER gespeichert (Spec § 12), Selbstschutz, kein loadManifests.
import type { App } from "obsidian";
import type { PluginInfo } from "../core/chat-context";
import { SELF_PLUGIN_ID } from "../core/write-policy";

// `app.plugins` ist nicht in `obsidian.d.ts` deklariert — schmales lokales Interface
// (undokumentierte, BRAT-erprobte API); vor jedem Aufruf ein Formcheck.
interface PluginManager {
  plugins: Record<string, unknown>;
  enabledPlugins: Set<string>;
  manifests: Record<string, { id: string; name: string }>;
  disablePlugin(id: string): Promise<void>;
  enablePlugin(id: string): Promise<void>;
}

function manager(app: App): PluginManager | null {
  const m = (app as unknown as { plugins?: PluginManager }).plugins;
  return m && typeof m === "object" ? m : null;
}

/** Geladen ODER gespeichert: ein Plugin, das gerade nicht läuft, aber eingeschaltet ist, zählt als aktiv. */
export function isPluginEnabled(app: App, id: string): boolean {
  const m = manager(app);
  if (!m) return false;
  const loaded = typeof m.plugins === "object" && m.plugins !== null && m.plugins[id] !== undefined;
  const persisted = m.enabledPlugins instanceof Set && m.enabledPlugins.has(id);
  return loaded || persisted;
}

export function installedPlugins(app: App): PluginInfo[] {
  const m = manager(app);
  if (!m || typeof m.manifests !== "object" || m.manifests === null) return [];
  return Object.values(m.manifests)
    .filter((x) => x.id !== SELF_PLUGIN_ID)
    .map((x) => ({ id: x.id, name: x.name }));
}

export function isInstalled(app: App, id: string): boolean {
  const m = manager(app);
  return !!m && typeof m.manifests === "object" && m.manifests !== null && m.manifests[id] !== undefined;
}

export async function disablePlugin(app: App, id: string): Promise<void> {
  if (id === SELF_PLUGIN_ID) throw new Error("self");
  const m = manager(app);
  if (m && typeof m.disablePlugin === "function") await m.disablePlugin(id);
}

export async function enablePlugin(app: App, id: string): Promise<void> {
  if (id === SELF_PLUGIN_ID) throw new Error("self");
  const m = manager(app);
  if (m && typeof m.enablePlugin === "function") await m.enablePlugin(id);
}
