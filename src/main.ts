import { Component, MarkdownRenderer, Notice, Plugin, getLanguage, normalizePath, type WorkspaceLeaf } from "obsidian";
import "./i18n/strings";
import { getLang, pickLang, setLang, t } from "./vendor/kit/i18n";
import type { EndpointConfig } from "./vendor/kit/endpoint_config";
import { onLevelFor, thinkingFor, type RequestSettings, type ThinkingLevel } from "./vendor/kit/sampling-profiles";
import { createLlmConnection, type LlmConnection } from "./vendor/kit-obsidian/llm-connection";
import { onEndpointManagerChanged } from "./vendor/kit-obsidian/endpoint-source";
import { loadSettings, type SettingsAssistantSettings } from "./core/settings";
import { applyLlmPatch, toLlmSettings } from "./core/llm-settings";
import { ApplyService } from "./obsidian/apply-service";
import { createSettingsAssistantApi, type SettingsAssistantApi } from "./obsidian/api";
import { openPluginSettings } from "./obsidian/apply-modal";
import { renderProfileBlock } from "./obsidian/profile-block";
import { createChatSend, type ChatSend } from "./obsidian/chat-send";
import { CHAT_MODE, SettingsAssistantSettingTab } from "./obsidian/settings-tab";
import { listSnapshots, pickUndoTarget } from "./obsidian/snapshots";
import { ChatSession } from "./obsidian/chat-session";
import { SettingsChatView, VIEW_TYPE_SA_CHAT, refreshChatViews } from "./obsidian/chat-view";
import { readConfig } from "./obsidian/config-io";
import { installedPlugins } from "./obsidian/plugin-host";
import { targetPath } from "./core/write-policy";

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class SettingsAssistantPlugin extends Plugin {
  settings: SettingsAssistantSettings = loadSettings(undefined);
  applyService!: ApplyService;
  /** Anbieter-API v1 (docs/API.md): `app.plugins.plugins["settings-assistant"].api`. */
  api!: SettingsAssistantApi;
  /** Die LLM-Anbindung: Endpunkt-Quelle, Auflösung, Parameter, Client, Prüfung der Antwort und die Settings-Abschnitte. */
  llm!: LlmConnection;
  private unsubscribeManager: () => void = () => {};
  private chatSession!: ChatSession;
  private readonly markdownHost = new Component();

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());
    this.llm = createLlmConnection({
      app: this.app,
      pluginId: this.manifest.id,
      caller: "settings-assistant",
      capability: "chat",
      // Die Antwort ist ein schema-validiertes Profil, kein freier Agent-Loop.
      mode: CHAT_MODE,
      // „Am Limit ohne Text“ bleibt ein Fehler (nicht ein leerer Antwortblock).
      truncated: "error",
      lang: () => getLang(),
      // Der Chat zeigt die Stufenwahl, wenn die Einstellung an ist.
      levelPicker: true,
      getSettings: () => toLlmSettings(this.settings),
      // Erst in die Settings schreiben, dann speichern: die Endpunkt-Liste liest ihre Zeilen danach zurück.
      persist: (patch) => {
        applyLlmPatch(this.settings, patch);
        return patch.request !== undefined ? this.saveSettings().then(() => this.refreshChatViews()) : this.saveSettings();
      },
    });
    this.applyService = new ApplyService(this.app, () => this.settings);
    this.api = createSettingsAssistantApi({ app: this.app, service: this.applyService });
    this.registerMarkdownCodeBlockProcessor("settings-profile", (src, el, ctx) =>
      renderProfileBlock(el, src, { service: this.applyService, sourcePath: ctx.sourcePath, openPluginSettings: (id) => { openPluginSettings(this.app, id); } }));

    this.addSettingTab(new SettingsAssistantSettingTab(this.app, this, {
      settings: this.settings,
      llm: this.llm,
      saveSettings: () => this.saveSettings(),
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
        family: () => this.llm.source().family,
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

    void this.llm.resolve().catch(() => undefined);
    this.unsubscribeManager = onEndpointManagerChanged(this.app, () => { this.llm.invalidate(); void this.llm.resolve().then(() => this.refreshChatViews()).catch(() => undefined); });
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => { if (leaf?.view instanceof SettingsChatView) void leaf.view.reload(); }));
  }

  /** Alle offenen Chat-Ansichten neu auflösen (Endpunkt oder Denkstufe geändert). */
  async refreshChatViews(): Promise<void> {
    await refreshChatViews(this.app.workspace.getLeavesOfType(VIEW_TYPE_SA_CHAT));
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
    await this.refreshChatViews();
  }

  /** Neuester Schnappschuss, der nicht selbst ein Zurückholen ist (Herkunft ≠ `restore:`). */
  private async undoLastApply(): Promise<void> {
    try {
      const latest = pickUndoTarget(await listSnapshots(this.app));
      if (!latest) { new Notice(t("snap.empty")); return; }
      await this.applyService.restoreInteractive(latest.dir);
    } catch (e) {
      new Notice(t("restore.failed", e instanceof Error ? e.message : String(e)));
    }
  }

  /** Löst die Chat-Quelle auf (Manager, sonst lokale Liste); die Verbindung merkt die lokale Auflösung bis `invalidate()`. */
  async resolveEndpoint(): Promise<EndpointConfig | null> {
    return (await this.llm.resolve()).config ?? null;
  }

  /** Anzeige für „Sent context“: Endpunkt-URL und das Modell, wie es gesendet wird (nie Schlüssel). */
  async describeEndpoint(): Promise<{ endpoint: string; model: string }> {
    try {
      const r = await this.llm.resolve();
      return { endpoint: r.config?.url ?? "", model: r.sentModel || r.model };
    } catch { return { endpoint: "", model: "" }; }
  }

  /** `send` für die Chat-Sitzung: ein Aufruf der Verbindung. */
  chatSend(): ChatSend {
    return createChatSend(this.llm);
  }
}
