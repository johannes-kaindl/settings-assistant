import { Notice, Plugin, getLanguage } from "obsidian";
import "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import { resolveEndpointSource, type EndpointSourceResult } from "./vendor/kit/endpoint-source";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import type { RequestSettings } from "./vendor/kit/sampling-profiles";
import { createRequestSession, type RequestSession } from "./vendor/kit-obsidian/request-session";
import type { RequestSectionState } from "./vendor/kit-obsidian/request-section";
import { findEndpointManager, onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { loadSettings, type SettingsAssistantSettings } from "./core/settings";
import { deviationNotice } from "./core/request-text";
import { ApplyService } from "./obsidian/apply-service";
import { openPluginSettings } from "./obsidian/apply-modal";
import { renderProfileBlock } from "./obsidian/profile-block";
import { PROBE_TIMEOUT_MS, probeEndpoint } from "./obsidian/http";
import { SettingsAssistantSettingTab } from "./obsidian/settings-tab";
import { listSnapshots } from "./obsidian/snapshots";

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class SettingsAssistantPlugin extends Plugin {
  settings: SettingsAssistantSettings = loadSettings(undefined);
  applyService!: ApplyService;
  requestSession: RequestSession = createRequestSession({ message: (d) => deviationNotice(d) });
  /** Letzte Auflösung der Chat-Quelle — trägt Familie/Backend für den Abschnitt „Anfrage“ (Task 14 nutzt sie für den Chat). */
  private activeSource: EndpointSourceResult | null = null;
  private cachedLocal: EndpointConfig | null = null;
  private pendingResolve: Promise<EndpointConfig | null> | null = null;
  private unsubscribeManager: () => void = () => {};

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());
    this.applyService = new ApplyService(this.app, () => this.settings);
    this.registerMarkdownCodeBlockProcessor("settings-profile", (src, el, ctx) =>
      renderProfileBlock(el, src, { service: this.applyService, sourcePath: ctx.sourcePath, openPluginSettings: (id) => { openPluginSettings(this.app, id); } }));

    this.addSettingTab(new SettingsAssistantSettingTab(this.app, this, {
      settings: this.settings,
      saveSettings: () => this.saveSettings(),
      saveRequestSettings: (next) => this.saveRequestSettings(next),
      requestSession: this.requestSession,
      requestSectionState: () => this.requestSectionState(),
      resolveEndpoint: () => this.resolveEndpoint(),
      invalidateEndpointCache: () => { this.cachedLocal = null; },
      activeEndpointUrl: () => this.activeSource?.config?.url ?? null,
      restore: (dir) => this.applyService.restoreInteractive(dir),
    }));

    this.addCommand({
      id: "undo-last-apply",
      name: t("cmd.undo"),
      callback: () => { void this.undoLastApply(); },
    });

    void this.resolveEndpoint();
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.cachedLocal = null; void this.resolveEndpoint(); });
  }

  onunload(): void { this.unsubscribeManager(); }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async saveRequestSettings(next: RequestSettings): Promise<void> {
    this.settings.request = next;
    await this.saveSettings();
  }

  /** Neuester Schnappschuss, der nicht selbst ein Zurückholen ist (Herkunft ≠ `restore:`). */
  private async undoLastApply(): Promise<void> {
    try {
      const latest = (await listSnapshots(this.app)).find((s) => !s.manifest.origin.startsWith("restore:"));
      if (!latest) { new Notice(t("snap.empty")); return; }
      await this.applyService.restoreInteractive(latest.dir);
    } catch (e) {
      new Notice(t("restore.failed", e instanceof Error ? e.message : String(e)));
    }
  }

  requestSectionState(): RequestSectionState {
    const s = this.activeSource;
    return {
      family: s?.family ?? null, familySource: s?.familySource ?? "none",
      ...(s?.displayFamily !== undefined ? { displayFamily: s.displayFamily } : {}),
      backend: s?.backend ?? "unknown", backendSource: s?.backendSource ?? "none",
      model: s?.model ?? "", sentModel: s?.sentModel ?? "",
      ...(s?.defaultModel !== undefined ? { defaultModel: s.defaultModel } : {}),
    };
  }

  /** Löst die Chat-Quelle auf (Manager, sonst lokale Liste) und merkt das Ergebnis; der lokale Pfad wird gecacht. */
  async resolveEndpoint(): Promise<EndpointConfig | null> {
    const manager = findEndpointManager(this.app);
    if (!manager && this.cachedLocal !== null) return this.cachedLocal;
    if (this.pendingResolve !== null) return this.pendingResolve;
    this.pendingResolve = resolveEndpointSource({
      manager,
      local: this.settings.endpoints,
      localModel: this.settings.localModel,
      capability: "chat",
      choice: this.settings.endpointChoice,
      caller: "settings-assistant",
    }, (ep) => probeEndpoint(ep, PROBE_TIMEOUT_MS).then((s) => s.kind === "ok"))
      .then((r) => {
        this.activeSource = r;
        if (r.kind === "local") this.cachedLocal = r.config;
        return r.config;
      })
      .finally(() => { this.pendingResolve = null; });
    return this.pendingResolve;
  }
}
