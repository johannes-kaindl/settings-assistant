// Muster (nicht Aufbau): lingotuner/src/obsidian/settings-tab.ts — Endpunkt-Quelle, Modell, Abschnitt „Anfrage“.
import { Notice, PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { getLang, t } from "../vendor/kit/i18n";
import { tn } from "../i18n/plural";
import { isValidRetentionValue, type SettingsAssistantSettings } from "../core/settings";
import { deviationDetail } from "../core/request-text";
import { PROBE_TIMEOUT_MS, clientFor } from "./http";
import { listSnapshots } from "./snapshots";
import { buildEndpointList, type EndpointListStrings } from "../vendor/kit-obsidian/endpoint-list";
import { buildEndpointSourceSection, findEndpointManager } from "../vendor/kit-obsidian/endpoint-source";
import { githubHelpUrls, helpSettingDefinition, HELP_SETTING_TEXTS_DE, HELP_SETTING_TEXTS_EN } from "../vendor/kit-obsidian/help-setting";
import type { CollapsibleStorage } from "../vendor/kit-obsidian/collapsible";
import { installTabRefreshOnOpen, refreshSettingsTab, renderSettingDefinitions, settingBodyHost } from "../vendor/kit-obsidian/settings_walker";
import { buildRequestSection, type RequestSectionState } from "../vendor/kit-obsidian/request-section";
import type { RequestSession } from "../vendor/kit-obsidian/request-session";
import { buildVersionList } from "../vendor/kit-obsidian/version-list";
import { createModelListCache, type ModelListCache } from "../vendor/kit/model-list-cache";
import { ENDPOINT_PRESETS, type EndpointStatusKind } from "../vendor/kit/endpoint_diagnostics";
import type { EndpointRole } from "../vendor/kit/endpoint_config";
import { BACKENDS, FAMILIES, type BackendId, type FamilyId, type FieldExplain, type ModeId, type RequestSettings } from "../vendor/kit/sampling-profiles";
import type { GfsPolicy } from "../vendor/kit/rotation";

/** Chat-Modus für „Anfrage“: schema-validierte Antwort (das Profil), kein freier Agent-Loop. */
export const CHAT_MODE: ModeId = "structured";

/** Was der Tab vom Plugin braucht — als Naht, damit der Tab ohne Plugin-Objekt prüfbar ist. */
export interface SettingsTabHost {
  settings: SettingsAssistantSettings;
  saveSettings(): Promise<void>;
  saveRequestSettings(next: RequestSettings): Promise<void>;
  requestSession: RequestSession;
  requestSectionState(): RequestSectionState;
  resolveEndpoint(): Promise<unknown>;
  invalidateEndpointCache(): void;
  activeEndpointUrl(): string | null;
  /** Zurückholen (Dialog + Schreibweg); der Tab zeichnet danach die Liste neu. */
  restore(dir: string): Promise<unknown>;
}

const STATUS_KEY: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "ep.status.ok",
  "refused": "ep.status.refused",
  "unknown-host": "ep.status.unknownHost",
  "timeout": "ep.status.timeout",
  "not-an-llm-api": "ep.status.notAnLlmApi",
  "unauthorized": "ep.status.unauthorized",
};
const WARN_KEY: Record<string, string> = {
  "scheme": "ep.warn.scheme",
  "malformed": "ep.warn.malformed",
  "port": "ep.warn.port",
  "placeholder-ip": "ep.warn.placeholderIp",
};
const RETENTION_FIELDS: Array<keyof GfsPolicy> = ["today", "days", "weeks", "months"];

export class SettingsAssistantSettingTab extends PluginSettingTab {
  /** Modell-Listen je Endpunkt — Lebensdauer des TABS (Kit-Vertrag), clear() in hide(). */
  private modelLists: ModelListCache = createModelListCache();
  /** Auf/Zu-Zustand des Abschnitts „Anfrage“ überlebt den Neuaufbau des Tabs (sonst klappt er bei jeder Änderung zu). */
  private readonly collapsedState = new Map<string, boolean>();
  private readonly collapsedStorage: CollapsibleStorage = {
    getCollapsed: (key) => this.collapsedState.get(key),
    setCollapsed: (key, collapsed) => { this.collapsedState.set(key, collapsed); },
  };

  private cleanupPrevious: () => void = () => {};
  private uninstallRefresh: () => void = () => {};

  constructor(app: App, plugin: Plugin, private readonly host: SettingsTabHost) {
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
      { type: "group", heading: t("set.chatModel"), items: [{ render: (s: Setting) => { this.renderChatModel(s); } }] },
      { type: "group", items: [{ name: t("request.title"), render: (s: Setting) => { this.renderRequest(s); } }] },
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

  hide(): void { this.modelLists.clear(); this.uninstallRefresh(); }

  getControlValue(_key: string): undefined { return undefined; }

  setControlValue(_key: string, _value: unknown): void { /* Alle Zeilen zeichnen sich selbst (render-Hatches). */ }

  private refreshUi(): void { refreshSettingsTab(this, () => this.renderImperative()); }

  private renderImperative(): void {
    this.cleanupPrevious();
    const { containerEl } = this;
    containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(containerEl, this.getSettingDefinitions(), this, this.app);
  }

  private endpointStrings(): EndpointListStrings {
    return {
      addPlaceholder: t("ep.addPlaceholder"),
      apiKeyPlaceholder: t("ep.apiKeyPlaceholder"),
      modelPlaceholder: t("ep.modelPlaceholder"),
      ariaUrl: t("ep.ariaUrl"),
      ariaAdd: t("ep.ariaAdd"),
      ariaApiKey: (url) => t("ep.ariaApiKey", url),
      ariaModel: (url) => t("ep.ariaModel", url),
      emptyModelLabel: (globalModel) => (globalModel ? t("ep.globalModel", globalModel) : t("ep.globalModelUnset")),
      modelHint: (key) => (key === "unreachable" ? t("ep.hint.unreachable") : key === "no-list" ? t("ep.hint.noList") : ""),
      savedSuffix: t("ep.saved"),
      refreshModels: t("ep.refreshModels"),
      moveToFront: t("ep.moveToFront"),
      remove: t("ep.remove"),
      thirdParty: t("ep.thirdParty"),
      probing: t("ep.probing"),
      statusTooltip: (status) => (status.kind === "unknown" ? t("ep.status.unknown", status.raw ?? "") : t(STATUS_KEY[status.kind])),
      role: (role: EndpointRole) => role.kind === "active" ? t("ep.role.active")
        : role.kind === "standby" ? t("ep.role.standby", String(role.position))
        : role.kind === "unreachable" ? t("ep.role.unreachable")
        : t("ep.role.skippedModel"),
      warnings: (warnings) => warnings.map((w) => (WARN_KEY[w.rule] ? t(WARN_KEY[w.rule] ?? "") : w.message)).join(" · "),
      presetTooltip: (preset) => t("ep.preset", preset.label),
      presetLabel: (preset) => preset.label,
      checkConnection: t("ep.checkConnection"),
      saveFailed: t("ep.saveFailed"),
    };
  }

  private renderChatModel(setting: Setting): void {
    const parent = settingBodyHost(setting);
    const s = this.host.settings;
    buildEndpointSourceSection({
      app: this.app, containerEl: parent, capability: "chat", caller: "settings-assistant",
      choice: () => s.endpointChoice,
      setChoice: async (c) => { s.endpointChoice = c; await this.host.saveSettings(); await this.host.resolveEndpoint(); },
      local: () => s.endpoints,
      strings: {
        managed: t("src.managed"), managedDesc: t("src.managedDesc"), openManager: t("src.openManager"),
        pickEndpoint: t("src.pickEndpoint"), automatic: t("src.automatic"), model: t("set.model"),
        importLocal: t("src.importLocal"), imported: (r) => t("src.imported", String(r.added.length), String(r.merged.length)), importFailed: t("src.importFailed"),
        modelHint: (key) => (key === "" ? "" : t(`set.modelHint.${key}`)), savedSuffix: t("ep.saved"), refreshModels: t("ep.refreshModels"),
        saveFailed: t("ep.saveFailed"),
      },
      renderLocalList: () => { this.renderLocalEndpoints(parent); },
      rerender: () => { this.refreshUi(); },
    });
  }

  private renderLocalEndpoints(parent: HTMLElement): void {
    const s = this.host.settings;
    buildEndpointList({
      containerEl: parent,
      label: t("src.pickEndpoint"),
      desc: "",
      placeholder: "http://127.0.0.1:1234",
      strings: this.endpointStrings(),
      cache: this.modelLists,
      get: () => s.endpoints,
      set: (eps) => { s.endpoints = eps; },
      active: () => this.host.activeEndpointUrl(),
      clientFor: (cfg) => clientFor(cfg, PROBE_TIMEOUT_MS),
      globalModel: () => s.localModel,
      save: () => this.host.saveSettings(),
      reconnect: async () => { this.host.invalidateEndpointCache(); await this.host.resolveEndpoint(); },
      rerender: () => { this.refreshUi(); },
      presets: ENDPOINT_PRESETS,
    });
    // Das globale Modell gibt es nur ohne Manager; mit Manager wählt der Abschnitt oben das Modell.
    if (!findEndpointManager(this.app)) {
      new Setting(parent).setName(t("set.model")).addText((tx) => {
        tx.setValue(s.localModel).onChange((v) => {
          s.localModel = v.trim();
          this.host.invalidateEndpointCache();
          void this.host.saveSettings().then(() => this.host.resolveEndpoint()).catch(() => { new Notice(t("ep.saveFailed")); });
        });
        tx.inputEl.setAttribute("aria-label", t("set.model"));
      });
    }
  }

  private fieldStateText(e: FieldExplain): string {
    const key = {
      "sent-effective": "request.state.sentEffective",
      "sent-unproven": "request.state.sentUnproven",
      "not-sent-ignored": "request.state.notSentIgnored",
      "not-sent-unsupported": "request.state.notSentUnsupported",
      "not-sent-unknown-family": "request.state.notSentUnknownFamily",
      "not-sent-no-value": "request.state.notSentNoValue",
    }[e.state];
    let text = t(key);
    const noteKey = e.note ? {
      "raised-to-reserve": "request.note.raisedToReserve",
      "raised-to-thinking-floor": "request.note.raisedToThinkingFloor",
      "below-thinking-floor": "request.note.belowThinkingFloor",
      "off-not-possible": "request.note.offNotPossible",
    }[e.note] : undefined;
    if (noteKey) text += ` ${t(noteKey)}`;
    if (e.field === "top_p") text += t("request.top_p.hint");
    return text;
  }

  private renderRequest(setting: Setting): void {
    buildRequestSection({
      containerEl: settingBodyHost(setting),
      modes: [CHAT_MODE],
      state: () => this.host.requestSectionState(),
      settings: () => this.host.settings.request,
      save: (next) => this.host.saveRequestSettings(next),
      maxTokens: () => undefined,
      session: this.host.requestSession,
      collapsedStorage: this.collapsedStorage,
      rerender: () => { this.refreshUi(); },
      strings: {
        title: t("request.title"),
        head: (family, familySource, backend, backendSource) => {
          const famLabel = family === "—" ? "—" : (FAMILIES[family as FamilyId]?.label ?? family);
          const backLabel = backend === "unknown" ? t("request.backendSource.none") : (BACKENDS[backend as BackendId]?.label ?? backend);
          return t("request.head", famLabel, t(`request.familySource.${familySource}`), backLabel, t(`request.backendSource.${backendSource}`));
        },
        unknownFamily: t("request.unknownFamily"),
        jitWarning: (model, defaultModel) => t("request.jitWarning", model, defaultModel),
        sentAs: (model) => t("request.sentAs", model),
        modeHeading: (mode) => t(`request.mode.${mode}`),
        fieldName: (field) => t(`request.field.${field}`),
        fieldDesc: (e) => this.fieldStateText(e),
        reset: t("request.reset"),
        thinkingLevel: t("request.thinkingLevel"),
        level: (l) => t(`request.level.${l}`),
        levelPicker: t("request.levelPicker"),
        levelPickerDesc: t("request.levelPickerDesc"),
        dormant: (fam) => t("request.dormant", fam === "unknown" ? t("request.familySource.none") : (FAMILIES[fam]?.label ?? fam)),
        deleteDormant: t("request.deleteDormant"),
        lastRequest: t("request.lastRequest"),
        lastRequestNone: t("request.lastRequestNone"),
        copy: t("request.copy"),
        copied: t("request.copied"),
        deviationsOk: t("request.deviationsOk"),
        deviationsWarn: (n) => t("request.deviationsWarn", String(n)),
        deviation: (kind, count, detail) => `${deviationDetail(kind, detail)} (${count}×)`,
      },
    });
  }

  private renderRetention(setting: Setting, field: keyof GfsPolicy): void {
    setting.addText((tx) => {
      tx.setValue(String(this.host.settings.retention[field])).onChange((v) => {
        // Nur gültige Werte (ganze Zahl ≥ 0) werden übernommen; alles andere lässt den gespeicherten Wert stehen.
        const n = v.trim() === "" ? Number.NaN : Number(v);
        if (!isValidRetentionValue(n)) return;
        this.host.settings.retention[field] = n;
        void this.host.saveSettings().catch(() => { new Notice(t("ep.saveFailed")); });
      });
      tx.inputEl.type = "number";
      tx.inputEl.min = "0";
      tx.inputEl.setAttribute("aria-label", `${t(`set.retention.${field}`)} — ${t("set.retention.unit")}`);
    });
  }

  private async renderSnapshotList(host: HTMLElement): Promise<void> {
    const all = await listSnapshots(this.app).catch(() => []);
    host.empty();
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
        void this.host.restore(dir).then(() => this.renderSnapshotList(host));
      },
    });
  }
}
