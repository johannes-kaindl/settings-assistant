import { Component, MarkdownRenderer, Notice, Plugin, getLanguage, normalizePath, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import { resolveEndpointSource, type EndpointSourceResult } from "./vendor/kit/endpoint-source";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import { onLevelFor, resolveRequestParams, thinkingFor, type RequestSettings, type ThinkingLevel } from "./vendor/kit/sampling-profiles";
import type { ChatClient } from "./vendor/kit-obsidian/chat-client";
import { createRequestSession, type RequestSession } from "./vendor/kit-obsidian/request-session";
import type { RequestSectionState } from "./vendor/kit-obsidian/request-section";
import { findEndpointManager, onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { loadSettings, type SettingsAssistantSettings } from "./core/settings";
import { deviationNotice } from "./core/request-text";
import { ApplyService } from "./obsidian/apply-service";
import { openPluginSettings } from "./obsidian/apply-modal";
import { renderProfileBlock } from "./obsidian/profile-block";
import { PROBE_TIMEOUT_MS, probeEndpoint } from "./obsidian/http";
import { cachedProbe, createChatSend, makeChatClient, type ChatSend } from "./obsidian/llm";
import { CHAT_MODE, SettingsAssistantSettingTab } from "./obsidian/settings-tab";
import { listSnapshots } from "./obsidian/snapshots";
import { ChatSession } from "./obsidian/chat-session";
import { SettingsChatView, VIEW_TYPE_SA_CHAT } from "./obsidian/chat-view";
import { readConfig } from "./obsidian/config-io";
import { installedPlugins } from "./obsidian/plugin-host";
import { targetPath } from "./core/write-policy";

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
  private chatClient: { key: string; client: ChatClient } | null = null;
  private unsubscribeManager: () => void = () => {};
  private chatSession!: ChatSession;
  private readonly markdownHost = new Component();

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

    this.addChild(this.markdownHost);
    this.chatSession = new ChatSession({
      send: this.chatSend(),
      describeEndpoint: () => this.describeEndpoint(),
      installed: () => installedPlugins(this.app),
      readSettings: (id) => readConfig(this.app, targetPath({ kind: "plugin", id }, this.app.vault.configDir)),
    });
    this.registerView(VIEW_TYPE_SA_CHAT, (leaf: WorkspaceLeaf) => new SettingsChatView(leaf, {
      session: this.chatSession,
      service: this.applyService,
      installed: () => installedPlugins(this.app),
      resolveEndpoint: async () => (await this.resolveEndpoint()) !== null,
      openOwnSettings: () => { openPluginSettings(this.app, this.manifest.id); },
      openPluginSettings: (id) => { openPluginSettings(this.app, id); },
      renderMarkdown: (el, md) => MarkdownRenderer.render(this.app, md, el, "", this.markdownHost),
      saveNote: (name, text) => this.saveProfileNote(name, text),
      thinking: {
        family: () => this.activeSource?.family ?? null,
        current: () => thinkingFor(this.settings.request, CHAT_MODE),
        onLevel: () => onLevelFor(this.settings.request, CHAT_MODE),
        setLevel: (l) => this.setChatThinking(l),
        levelPicker: () => this.settings.request.levelPickerInChat,
        strings: {
          button: (level, offNotPossible) => level !== "off" ? t("chat.think.on", t(`request.level.${level}`)) : offNotPossible ? t("chat.think.min") : t("chat.think.off"),
          level: (l) => t(`request.level.${l}`),
          pickerLabel: t("request.thinkingLevel"),
        },
      },
      now: () => new Date(),
    }));
    this.addCommand({ id: "open-chat", name: t("cmd.chat"), callback: () => { void this.openChat(); } });
    this.addRibbonIcon("sliders-horizontal", t("cmd.chat"), () => { void this.openChat(); });

    void this.resolveEndpoint();
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.cachedLocal = null; void this.resolveEndpoint(); });
  }

  private async openChat(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_SA_CHAT)[0];
    const leaf = existing ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_SA_CHAT, active: true });
    await workspace.revealLeaf(leaf);
  }

  private async setChatThinking(level: ThinkingLevel): Promise<void> {
    const next: RequestSettings = { ...this.settings.request, thinking: { ...this.settings.request.thinking, [CHAT_MODE]: level } };
    if (level !== "off") next.lastOnLevel = { ...next.lastOnLevel, [CHAT_MODE]: level };
    await this.saveRequestSettings(next);
  }

  /** Neue Notiz im Ordner der aktiven Notiz (sonst Vault-Wurzel); ein vorhandener Name bekommt ein Suffix. */
  private async saveProfileNote(name: string, text: string): Promise<string> {
    const dir = this.app.workspace.getActiveFile()?.parent?.path ?? "";
    const prefix = dir === "" || dir === "/" ? "" : `${dir}/`;
    let path = normalizePath(`${prefix}${name}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path) !== null; i++) path = normalizePath(`${prefix}${name} ${i}.md`);
    await this.app.vault.create(path, text);
    return path;
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
      backendOf: (cfg) => cachedProbe(cfg.url, cfg.model || this.settings.localModel),
    }, (ep) => probeEndpoint(ep, PROBE_TIMEOUT_MS).then((s) => s.kind === "ok"))
      .then((r) => {
        this.activeSource = r;
        if (r.kind === "local") this.cachedLocal = r.config;
        return r.config;
      })
      .finally(() => { this.pendingResolve = null; });
    return this.pendingResolve;
  }

  /** Anzeige für „Sent context“: Endpunkt-URL und das Modell, wie es gesendet wird (nie Schlüssel). */
  describeEndpoint(): { endpoint: string; model: string } {
    const s = this.activeSource;
    return { endpoint: s?.config?.url ?? "", model: s?.sentModel ?? s?.model ?? "" };
  }

  /** `send` für die Chat-Sitzung (Task 15 reicht sie an `ChatSession` weiter). Löst den Endpunkt bei jedem Aufruf frisch auf. */
  chatSend(): ChatSend {
    return createChatSend({
      resolve: async () => {
        const endpoint = await this.resolveEndpoint();
        const src = this.activeSource;
        if (endpoint === null || src === null) return null;
        const family = src.family ?? null;
        const thinking = thinkingFor(this.settings.request, CHAT_MODE);
        const overrides = this.settings.request.overrides[CHAT_MODE]?.[family ?? "unknown"] ?? {};
        const { params } = resolveRequestParams({ family, mode: CHAT_MODE, backend: src.backend ?? "unknown", thinking, overrides });
        return { endpoint, sentModel: src.sentModel || src.model, params, family, thinking };
      },
      client: (target) => {
        const key = `${target.endpoint.url}|${this.activeSource?.transport ?? "http"}`;
        if (this.chatClient?.key !== key) this.chatClient = { key, client: makeChatClient(this.activeSource) };
        return this.chatClient.client;
      },
      recordRequest: (params) => { this.requestSession.recordRequest(params); },
      report: (ds) => { this.requestSession.report(ds); },
    });
  }
}
