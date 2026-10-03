// src/core/write-policy.ts
import { PLUGIN_ID_RE } from "./profile";
import type { ObsidianFile, Target } from "./types";

const validPluginId = (id: string): boolean => PLUGIN_ID_RE.test(id) && !id.includes("..");

export type Stage = 1 | 2 | 3;
/** Spec § 4: jede Stufe bekommt nur die Rechte, die sie braucht. */
export const CURRENT_STAGE: Stage = 1;
export const SELF_PLUGIN_ID = "settings-assistant";

const WRITE_STAGE: Record<"plugin" | ObsidianFile, Stage> = {
  plugin: 1, hotkeys: 1, app: 2, appearance: 2, "core-plugins": 3, "community-plugins": 3,
};

export function isWritable(t: Target, stage: Stage = CURRENT_STAGE): boolean {
  if (t.kind === "plugin" && (!validPluginId(t.id) || t.id === SELF_PLUGIN_ID)) return false;
  return WRITE_STAGE[t.kind === "plugin" ? "plugin" : t.file] <= stage;
}

export function targetPath(t: Target, configDir: string): string {
  if (t.kind === "plugin" && !validPluginId(t.id)) throw new Error("invalid plugin id");
  return t.kind === "plugin" ? `${configDir}/plugins/${t.id}/data.json` : `${configDir}/${t.file}.json`;
}
