// Der Befehl „Plugin-Stand als Profilnotiz speichern“: ein Plugin wählen, seinen Ist-Stand (data.json) ohne Modell als Profilnotiz ablegen.
// Dieselbe Notiz, derselbe Schwärz-Weg und derselbe Ablageort wie „Als Profilnotiz speichern“ im Chat; der Import ist die Notiz selbst
// (Codeblock `settings-profile`, Anwenden über den Prüfdialog). Auswahl: Obsidian-natives FuzzySuggestModal (Vorbild `ImagePickerModal` in local-image-generator).
import { FuzzySuggestModal, Notice, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { PluginInfo } from "../core/chat-context";
import { profileFromState } from "../core/profile-export";
import { profileNoteName, redactedProfileNote } from "../core/profile-note";
import { targetPath } from "../core/write-policy";
import { readConfig } from "./config-io";
import { installedPlugins } from "./plugin-host";
import { errorMessage } from "../vendor/kit/error-message";

export class PluginPickerModal extends FuzzySuggestModal<PluginInfo> {
  constructor(app: App, private readonly plugins: readonly PluginInfo[], private readonly onPick: (plugin: PluginInfo) => void) {
    super(app);
    this.setPlaceholder(t("export.placeholder"));
  }

  getItems(): PluginInfo[] { return [...this.plugins]; }

  getItemText(p: PluginInfo): string { return `${p.name} (${p.id})`; }

  onChooseItem(p: PluginInfo): void { this.onPick(p); }
}

export interface ExportStateDeps {
  app: App;
  /** Legt die Notiz an und gibt ihren Pfad zurück (`saveProfileNote` des Plugins, wie im Chat). */
  save(name: string, text: string): Promise<string>;
  now(): Date;
}

/** Öffnet die Auswahl; ohne weitere Plugins nur eine Meldung. */
export function openExportState(deps: ExportStateDeps): void {
  const plugins = installedPlugins(deps.app);
  if (plugins.length === 0) { new Notice(t("export.none")); return; }
  new PluginPickerModal(deps.app, plugins, (p) => { void exportPluginState(deps, p); }).open();
}

/** Liest den Ist-Stand, schwärzt Geheimnisse und legt die Notiz ab. Jede Ablehnung nennt nur den Grund, nie Text oder eine `JSON.parse`-Meldung. */
export async function exportPluginState(deps: ExportStateDeps, plugin: PluginInfo): Promise<void> {
  try {
    const text = await readConfig(deps.app, targetPath({ kind: "plugin", id: plugin.id }, deps.app.vault.configDir));
    const result = profileFromState(plugin.id, text);
    if (!result.ok) { new Notice(t(`export.refused.${result.reason}`, plugin.name)); return; }
    const note = redactedProfileNote(result.profile);
    const path = await deps.save(profileNoteName(deps.now()), note.text);
    new Notice(t("chat.saved", path));
    if (note.redacted.length > 0) new Notice(t("chat.saveRedacted", note.redacted.join(", ")));
  } catch (e) {
    new Notice(t("chat.saveFailed", errorMessage(e)));
  }
}
