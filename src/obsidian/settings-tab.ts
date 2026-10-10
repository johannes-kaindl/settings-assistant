// Muster (nicht Aufbau): lingotuner/src/obsidian/settings-tab.ts — Endpunkt-Quelle, Modell, Abschnitt „Anfrage“.
import { Notice, PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { getLang, t } from "../vendor/kit/i18n";
import { tn } from "../i18n/plural";
import { isValidRetentionValue, type SettingsAssistantSettings } from "../core/settings";
import { listSnapshots } from "./snapshots";
import { githubHelpUrls, helpSettingDefinition, HELP_SETTING_TEXTS_DE, HELP_SETTING_TEXTS_EN } from "../vendor/kit-obsidian/help-setting";
import { installTabRefreshOnOpen, renderSettingDefinitions, settingBodyHost } from "../vendor/kit-obsidian/settings_walker";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import { buildVersionList } from "../vendor/kit-obsidian/version-list";
import type { ModeId } from "../vendor/kit/sampling-profiles";
import type { GfsPolicy } from "../vendor/kit/rotation";

/** Chat-Modus für „Anfrage“: schema-validierte Antwort (das Profil), kein freier Agent-Loop. */
export const CHAT_MODE: ModeId = "structured";

/** Was der Tab vom Plugin braucht — als Naht, damit der Tab ohne Plugin-Objekt prüfbar ist. */
export interface SettingsTabHost {
  settings: SettingsAssistantSettings;
  llm: LlmConnection;
  saveSettings(): Promise<void>;
  /** Zurückholen (Dialog + Schreibweg); der Tab zeichnet danach die Liste neu. */
  restore(dir: string): Promise<unknown>;
}

const RETENTION_FIELDS: Array<keyof GfsPolicy> = ["today", "days", "weeks", "months"];

export class SettingsAssistantSettingTab extends PluginSettingTab {
  private cleanupPrevious: () => void = () => {};
  private uninstallRefresh: () => void = () => {};

  constructor(app: App, private readonly plugin: Plugin, private readonly host: SettingsTabHost) {
    super(app, plugin);
    // Die Schnappschuss-Liste soll beim Öffnen des Tabs aktuell sein.
    this.uninstallRefresh = installTabRefreshOnOpen(this, () => this.renderImperative());
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const retention = RETENTION_FIELDS.map((field) => ({ name: t(`set.retention.${field}`), render: (s: Setting) => { this.renderRetention(s, field); } }));
    const defs = [
      // UI-STANDARD §8: die Hilfe-Zeile ist das erste Element des Tabs.
      helpSettingDefinition({
        ...githubHelpUrls("settings-assistant"),
        texts: getLang() === "de" ? HELP_SETTING_TEXTS_DE : HELP_SETTING_TEXTS_EN,
      }),
      { type: "group", heading: t("set.chatModel"), items: [
        { render: (s: Setting) => { this.host.llm.renderSettings(settingBodyHost(s), { lang: getLang() }); } },
      ] },
      {
        type: "group",
        heading: t("set.snapshots"),
        items: [
          { name: t("set.retention.title"), desc: t("set.retention.desc"), render: () => {} },
          ...retention,
          { render: (s: Setting) => { void this.renderSnapshotList(settingBodyHost(s)); } },
        ],
      },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  display(): void { this.renderImperative(); }

  hide(): void { this.host.llm.hideSettings(); this.uninstallRefresh(); }

  getControlValue(_key: string): undefined { return undefined; }

  setControlValue(_key: string, _value: unknown): void { /* Alle Zeilen zeichnen sich selbst (render-Hatches). */ }

  private renderImperative(): void {
    this.cleanupPrevious();
    const { containerEl } = this;
    containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(containerEl, this.getSettingDefinitions(), this, this.app);
  }

  private renderRetention(setting: Setting, field: keyof GfsPolicy): void {
    setting.addText((tx) => {
      tx.setValue(String(this.host.settings.retention[field])).onChange((v) => {
        // Nur gültige Werte (ganze Zahl ≥ 0) werden übernommen; alles andere lässt den gespeicherten Wert stehen.
        const n = v.trim() === "" ? Number.NaN : Number(v);
        if (!isValidRetentionValue(n)) return;
        this.host.settings.retention[field] = n;
        void this.host.saveSettings().catch(() => { new Notice(t("set.saveFailed")); });
      });
      tx.inputEl.type = "number";
      tx.inputEl.min = "0";
      tx.inputEl.setAttribute("aria-label", `${t(`set.retention.${field}`)} — ${t("set.retention.unit")}`);
    });
  }

  private async renderSnapshotList(outer: HTMLElement): Promise<void> {
    const all = await listSnapshots(this.app).catch(() => []);
    outer.empty();
    const host = outer.createDiv({ cls: "sa-snapshots" });
    if (all.length === 0) {
      host.createDiv({ cls: "sa-empty", text: t("snap.empty") });
      return;
    }
    host.createDiv({ cls: "sa-snapshots-hint", text: t("snap.hint") });
    buildVersionList(host, {
      heading: t("snap.heading"),
      minItems: 1,
      active: -1,
      items: all.map((s) => ({
        label: new Date(s.manifest.at).toLocaleString(getLang()),
        meta: `${s.manifest.origin} · ${tn("snap.files", s.manifest.files.length)}`,
      })),
      onSelect: (i) => {
        const dir = all[i]?.dir;
        if (dir === undefined) return;
        void this.host.restore(dir).then(() => this.renderSnapshotList(outer));
      },
    });
  }
}
