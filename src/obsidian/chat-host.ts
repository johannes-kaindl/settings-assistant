// Der Wirt des Chat-Fensters (obsidian-kit `buildChatWindow`, UI-STANDARD § 8 Baustein 12) und der Modellzeile (`buildModelBar`, Baustein 15).
// Hier steht nur, was dieses Plugin selbst sagt: Kontext und Prompt (`prepareAsk`), Chips der Plugin-Auswahl, Vorschlagsblöcke und „Sent context“ unter
// der Antwort, der Linkschutz nach dem Rendern. Verlauf, Eingabe, Abbruch, Fehlerzeile und Kopieren trägt das Kit.
import { ItemView, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { getLang, t } from "../vendor/kit/i18n";
import { EMPTY_CHAT, type ChatHistory, type ChatModelMessage } from "../vendor/kit/chat-history";
import { buildChatWindow, type ChatSendHandlers, type ChatSendResult, type ChatWindow } from "../vendor/kit-obsidian/chat-window";
import { buildModelBar, type ModelBar } from "../vendor/kit-obsidian/model-bar";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import type { ThinkingControlOptions } from "../vendor/kit-obsidian/thinking-control";
import type { PluginInfo } from "../core/chat-context";
import { prepareAsk } from "../core/chat-ask";
import { stripProfileBlocks } from "../core/profile-fence";
import { drawAnswerExtras, type ChatAnswerDeps } from "./chat-answer";
import { stripActiveContent } from "./dom-safety";

export const VIEW_TYPE_SA_CHAT = "settings-assistant-chat";

/** Was das Schließen und Öffnen der Ansicht überleben soll; das Plugin hält es im Speicher (nie auf Platte). */
export interface ChatState {
  history: ChatHistory;
  /** Ids der Plugins in der Frage (Chips). Leer = aus der nächsten Frage vorschlagen. */
  selected: string[];
}

export function newChatState(): ChatState { return { history: EMPTY_CHAT, selected: [] }; }

export interface ChatHostDeps extends ChatAnswerDeps {
  app: App;
  llm: Pick<LlmConnection, "complete" | "models" | "setModel" | "modelInUse" | "source">;
  state: ChatState;
  installed(): PluginInfo[];
  readSettings(id: string): Promise<string | null>;
  describeEndpoint(): { endpoint: string; model: string } | Promise<{ endpoint: string; model: string }>;
  /** Löst die Chat-Quelle auf; `true`, wenn ein Endpunkt bereitsteht. */
  resolveEndpoint(): Promise<boolean>;
  openOwnSettings(): void;
  /** Rendert Markdown in `el` (Obsidian `MarkdownRenderer`); kein innerHTML. */
  renderMarkdown(el: HTMLElement, markdown: string): Promise<void>;
  thinking: Omit<ThinkingControlOptions, "containerEl">;
  /** Nur im Test mit dem Fake-DOM `false` (Durchgriff an den Schreiber des Kits). */
  domGuard?: boolean;
}

export class SettingsChatHost extends ItemView {
  private endpointOk = false;
  private win: ChatWindow | null = null;
  private bar: ModelBar | null = null;
  private chipsEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly deps: ChatHostDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_SA_CHAT; }
  getDisplayText(): string { return t("chat.title"); }
  getIcon(): string { return "sliders-horizontal"; }

  async onOpen(): Promise<void> {
    await this.resolve();
    this.build();
  }

  onClose(): Promise<void> {
    this.win?.destroy();
    this.bar?.destroy();
    this.win = null;
    this.bar = null;
    return Promise.resolve();
  }

  /** Sendet eine Frage wie die Eingabe (Test und Befehle); ohne Text die Eingabe. */
  async submit(text?: string): Promise<void> { await this.win?.submit(text); }

  private async resolve(): Promise<boolean> {
    try { this.endpointOk = await this.deps.resolveEndpoint(); } catch { this.endpointOk = false; }
    return this.endpointOk;
  }

  /** Nach Änderungen an Endpunkt oder Einstellungen. Ändert sich der Endpunkt-Zustand, zeichnet das Fenster neu (`refresh()` baut auch die
   *  Bereiche unter den Antworten neu; sonst bleibt „gespeichert“ an einem Vorschlagsblock nicht erhalten); sonst genügt die Modellzeile.
   *  `models`: auch die Modell-Liste neu laden (der Endpunkt oder die Liste der Endpunkte hat sich geändert). */
  async reload(opts: { models?: boolean } = {}): Promise<void> {
    const before = this.endpointOk;
    if ((await this.resolve()) !== before) { this.win?.refresh(); return; }
    this.bar?.update();
    if (opts.models === true) void this.bar?.refresh();
  }

  /** Ob eine Antwort läuft: das Kit-Fenster hat kein `running()`, aber `startAnswer` läuft vor `send`, also zeigt der Verlauf den Lauf. */
  private running(): boolean {
    return this.win?.history().entries.some((e) => e.kind === "assistant" && e.state === "streaming") ?? false;
  }

  private build(): void {
    this.win?.destroy();
    this.bar?.destroy();
    this.bar = null;
    const d = this.deps;
    const root = this.contentEl;
    root.empty();
    // Der Wirt braucht eine begrenzte Höhe, sonst rollt der Verlauf nicht (Kit-Falle); die Regel steht in der styles.css.
    root.addClass("sa-chat-host");
    this.win = buildChatWindow(root, {
      cls: "sa-chat",
      strings: { lang: getLang(), placeholder: t("chat.placeholder") },
      send: (messages, h) => this.send(messages, h),
      render: async (el, markdown) => {
        await d.renderMarkdown(el, markdown);
        // Der Kit-`domGuard` kappt keine Skript-Schemata in Links (code-kit `remote-resources`): das tut `dom-safety`.
        stripActiveContent(el);
      },
      answerTransform: stripProfileBlocks,
      header: (el) => { this.drawHeader(el); },
      composer: (el) => { this.drawComposer(el); },
      afterAnswer: (el, entry) => { drawAnswerExtras(el, entry, d); },
      empty: {
        when: () => !this.endpointOk,
        title: t("chat.title"),
        text: t("chat.empty.text"),
        cta: { label: t("chat.empty.cta"), onClick: () => { d.openOwnSettings(); } },
      },
      initial: d.state.history,
      onChange: (h) => {
        d.state.history = h;
        // Die Zeile sperrt sich während eines Laufs und gibt sich danach frei; die Chips folgen der Liste der installierten Plugins.
        this.bar?.update();
        this.drawChips();
      },
      ...(d.domGuard === undefined ? {} : { domGuard: d.domGuard }),
    });
  }

  private async send(messages: readonly ChatModelMessage[], h: ChatSendHandlers): Promise<ChatSendResult> {
    const d = this.deps;
    // `startAnswer` ist vor `send` gelaufen: ab hier ist der Lauf im Verlauf sichtbar, die Zeile sperrt sich.
    this.bar?.update();
    const prep = await prepareAsk({
      history: messages,
      selected: d.state.selected,
      deps: { installed: () => d.installed(), readSettings: (id) => d.readSettings(id), describeEndpoint: () => d.describeEndpoint() },
    });
    d.state.selected = prep.selected;
    this.drawChips();
    // Nur Namen und Pfade, nie Werte: der Prompt ist aus `buildContext` und enthält keine geheimen Werte.
    h.setMeta(prep.sent);
    return d.llm.complete({ messages: prep.messages }, {
      signal: h.signal,
      onToken: (text) => { h.onToken(text); },
      onReasoning: (text) => { h.onReasoning(text); },
      onContentReset: () => { h.onContentReset(); },
    });
  }

  private drawHeader(el: HTMLElement): void {
    // `refresh()` ruft den Einschub erneut; die alte Zeile gibt das Kit nicht frei (kein Abmelde-Hook), also hier.
    this.bar?.destroy();
    this.bar = null;
    if (!this.endpointOk) return;
    const d = this.deps;
    this.bar = buildModelBar({
      app: d.app,
      containerEl: el,
      llm: d.llm,
      label: t("chat.modelLabel"),
      strings: { lang: getLang() },
      thinking: d.thinking,
      disabled: () => this.running(),
    });
  }

  private drawComposer(el: HTMLElement): void {
    this.chipsEl = el.createDiv({ cls: "sa-chat-chips", attr: { "aria-label": t("chat.chips") } });
    this.drawChips();
  }

  /** Die Chips zeichnen sich selbst neu, ohne `win.refresh()`: das würde die Bereiche unter allen Antworten neu bauen (Zustand „gespeichert“ weg). */
  private drawChips(): void {
    const el = this.chipsEl;
    if (!el || !this.endpointOk) return;
    const d = this.deps;
    el.empty();
    const installed = d.installed();
    const names = new Map(installed.map((p) => [p.id, p.name]));
    for (const id of d.state.selected) {
      const chip = el.createSpan({ cls: "sa-chip" });
      chip.createSpan({ cls: "sa-chip-label", text: names.get(id) ?? id });
      const rm = chip.createEl("button", { cls: "sa-chip-remove clickable-icon", attr: { "aria-label": t("chat.remove", names.get(id) ?? id) } });
      setIcon(rm, "x");
      rm.addEventListener("click", () => {
        d.state.selected = d.state.selected.filter((x) => x !== id);
        this.drawChips();
      });
    }
    const free = installed.filter((p) => !d.state.selected.includes(p.id));
    if (free.length === 0) return;
    const sel = el.createEl("select", { cls: "dropdown sa-chip-add", attr: { "aria-label": t("chat.addPlugin") } });
    sel.createEl("option", { text: t("chat.addPlugin") }).value = "";
    for (const p of free) sel.createEl("option", { text: p.name }).value = p.id;
    sel.addEventListener("change", () => {
      if (sel.value === "") return;
      d.state.selected = [...d.state.selected, sel.value];
      this.drawChips();
    });
  }
}

/** Lädt alle offenen Chat-Ansichten neu (nach Endpunkt- oder Einstellungsänderung). */
export async function refreshChatViews(leaves: readonly WorkspaceLeaf[], opts: { models?: boolean } = {}): Promise<void> {
  for (const leaf of leaves) if (leaf.view instanceof SettingsChatHost) await leaf.view.reload(opts);
}
