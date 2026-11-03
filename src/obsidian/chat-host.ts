// Der Wirt des Chat-Fensters (obsidian-kit `buildChatWindow`, UI-STANDARD § 8 Baustein 12) und der Modellzeile (`buildModelBar`, Baustein 15).
// Hier steht nur, was dieses Plugin selbst sagt: Kontext und Prompt (`prepareAsk`), Chips der Plugin-Auswahl, Vorschlagsblöcke und „Sent context“ unter
// der Antwort. Den Linkschutz trägt der `domGuard` des Kit-Fensters. Verlauf, Eingabe, Abbruch, Fehlerzeile und Kopieren trägt das Kit.
import { ItemView, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { getLang, t } from "../vendor/kit/i18n";
import { EMPTY_CHAT, type ChatHistory, type ChatModelMessage } from "../vendor/kit/chat-history";
import { buildChatWindow, type ChatSendHandlers, type ChatSendResult, type ChatWindow } from "../vendor/kit-obsidian/chat-window";
import { buildModelBar, type ModelBar } from "../vendor/kit-obsidian/model-bar";
import type { ChatArchive } from "../vendor/kit-obsidian/chat-archive";
import type { LlmConnection } from "../vendor/kit-obsidian/llm-connection";
import type { ThinkingControlOptions } from "../vendor/kit-obsidian/thinking-control";
import type { PluginInfo } from "../core/chat-context";
import { prepareAsk } from "../core/chat-ask";
import { stripProfileBlocks } from "../core/profile-fence";
import { drawAnswerExtras, type ChatAnswerDeps } from "./chat-answer";

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
  /** Der Verlauf vergangener Chats (Kit-Speicher, `payloadType okit-chat-history/1`). */
  archive: ChatArchive;
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
  /** Der Knopf „Plugins (n)“ in der Knopfreihe des Composers (neben Neu und Verlauf): bei offener Tastatur am Handy steht er für die Chip-Zeile, ein Tipp klappt sie auf. */
  private chipsToggle: HTMLButtonElement | null = null;
  private chipsOpen = false;
  private readonly onInputFocus = (): void => { this.setChipsOpen(false); };

  constructor(leaf: WorkspaceLeaf, private readonly deps: ChatHostDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_SA_CHAT; }
  getDisplayText(): string { return t("chat.title"); }
  getIcon(): string { return "sliders-horizontal"; }

  async onOpen(): Promise<void> {
    await this.resolve();
    this.build();
  }

  onClose(): Promise<void> {
    // `destroy()` ruft die Abmeldung des Kopfs: die Modellzeile gibt sich dabei frei.
    this.win?.destroy();
    this.win = null;
    return Promise.resolve();
  }

  /** Sendet eine Frage wie die Eingabe (Test und Befehle); ohne Text die Eingabe. */
  async submit(text?: string): Promise<void> { await this.win?.submit(text); }

  /** Befehl „Start new chat“: `clear()` leert ohne Rückfrage; ist der Verlauf an, sichert das Fenster das Gespräch vorher (Kit 0.73.0). */
  newChat(): void { this.win?.clear(); }

  /** Befehl „Open past chats…“. Ohne Verlauf, im Lauf und im Leerzustand tut es nichts. */
  openArchive(): void { this.win?.openArchive(); }

  /** Nach einer geänderten Aufbewahrung folgt der Verlauf-Knopf des Fensters. */
  refreshArchive(): void { this.win?.refresh(); }

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

  private build(): void {
    this.win?.destroy();
    const d = this.deps;
    const root = this.contentEl;
    root.empty();
    // Der Wirt braucht eine begrenzte Höhe, sonst rollt der Verlauf nicht (Kit-Falle); die Regel steht in der styles.css.
    root.addClass("sa-chat-host");
    this.win = buildChatWindow(root, {
      cls: "sa-chat",
      strings: { lang: getLang(), placeholder: t("chat.placeholder") },
      send: (messages, h) => this.send(messages, h),
      // Aktive Elemente, Quellen und gefährliche Link-Ziele kappt der `domGuard` des Kit-Fensters (seit Kit 0.70.0, `obsidian://` nur mit seiner Option).
      render: (el, markdown) => d.renderMarkdown(el, markdown),
      answerTransform: stripProfileBlocks,
      // Die einzeilige Modellzeile baut `drawComposer` als direktes Kind des Einschubs; das Fenster hebt sie (Kit 0.74.0) in den Composer, über das Textfeld, bei geringer Höhe darunter.
      composer: (el) => this.drawComposer(el),
      afterAnswer: (el, entry) => { drawAnswerExtras(el, entry, d); },
      empty: {
        when: () => !this.endpointOk,
        title: t("chat.title"),
        text: t("chat.empty.text"),
        cta: { label: t("chat.empty.cta"), onClick: () => { d.openOwnSettings(); } },
      },
      initial: d.state.history,
      archive: { store: d.archive, app: d.app, model: () => d.llm.modelInUse(), thinking: () => d.thinking.current() },
      onChange: (h) => {
        d.state.history = h;
        // Die Chips folgen der Liste der installierten Plugins.
        this.drawChips();
      },
      // Die Zeile sperrt sich während eines Laufs und gibt sich danach frei.
      onRunChange: () => { this.bar?.update(); },
      ...(d.domGuard === undefined ? {} : { domGuard: d.domGuard }),
    });
  }

  private async send(messages: readonly ChatModelMessage[], h: ChatSendHandlers): Promise<ChatSendResult> {
    const d = this.deps;
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

  /** Der Einschub über dem Textfeld: das Kit ruft ihn beim Bau und bei `refresh()` und danach die Rückgabe, bevor es neu zeichnet. Die Modellzeile baut er als DIREKTES Kind des Einschubs
   *  (Kit 0.74.0): das Fenster hebt sie von dort in den Composer, ein Wrapper darum bliebe stehen und der kompakte Composer griffe nicht. Im Einschub bleiben nur die Chips der Plugin-Auswahl;
   *  sie zeichnen sich allein neu (`drawChips`), die Zeile bleibt dabei stehen. */
  private drawComposer(el: HTMLElement): () => void {
    this.chipsEl = el.createDiv({ cls: "sa-chat-chips", attr: { "aria-label": t("chat.chips") } });
    this.fillChips();
    if (!this.endpointOk) return () => { this.dropToggle(); };
    const d = this.deps;
    const bar = buildModelBar({
      app: d.app,
      containerEl: el,
      llm: d.llm,
      label: t("chat.modelLabel"),
      strings: { lang: getLang() },
      thinking: d.thinking,
      disabled: () => this.win?.running() ?? false,
    });
    this.bar = bar;
    return () => {
      bar.destroy();
      if (this.bar === bar) this.bar = null;
      this.dropToggle();
    };
  }

  /** Der Knopf „Plugins (n)“ steht in der Knopfreihe des Kit-Fensters (`.okit-chat-buttons-start`, die Zeile mit Neu und Verlauf hat in der Mitte Platz), nicht in einer eigenen Zeile: ob er sichtbar ist, entscheidet die CSS
   *  (nur Handy, nur solange die Eingabe den Fokus hat, also bei offener Tastatur; dann ist die Chip-Zeile zu, bis man ihn tippt). Er wird einmal angelegt und zeichnet nur Zahl und Zustand neu. */
  private ensureToggle(): HTMLButtonElement | null {
    if (this.chipsToggle?.parentElement) return this.chipsToggle;
    // Aufwärts über parentElement statt `closest` (das Fake-DOM der Tests kennt es nicht).
    let composer: HTMLElement | null = this.chipsEl?.parentElement ?? null;
    while (composer && !composer.classList.contains("okit-chat-composer")) composer = composer.parentElement;
    const row = composer?.querySelector(".okit-chat-buttons-start") ?? null;
    if (!row) return null;
    const btn = (row as HTMLElement).createEl("button", { cls: "sa-chips-toggle", attr: { type: "button", "aria-expanded": "false" } });
    // Der Druck darf der Eingabe den Fokus nicht nehmen: sonst schließt die Tastatur, der Knopf verschwindet unter dem Finger, und der Tipp kommt nie an (Maus in der Emulation; am Handy nimmt ein Knopf den Fokus ohnehin nicht).
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); });
    btn.addEventListener("click", () => { this.setChipsOpen(!this.chipsOpen); });
    // Ein neuer Fokus in der Eingabe klappt die Zeile wieder ein: wer weitertippt, will den Platz. Dieselbe Funktion je Aufruf, damit ein zweites addEventListener nichts verdoppelt.
    row.parentElement?.querySelector(".okit-chat-input")?.addEventListener("focus", this.onInputFocus);
    this.chipsToggle = btn;
    return btn;
  }

  private dropToggle(): void {
    this.chipsToggle?.remove();
    this.chipsToggle = null;
  }

  private setChipsOpen(open: boolean): void {
    this.chipsOpen = open;
    this.chipsEl?.toggleClass("is-open", open);
    this.chipsToggle?.setAttribute("aria-expanded", String(open));
  }

  /** Nur die Chips zeichnen sich neu: Modellzeile, Entwurf und die Bereiche unter den Antworten bleiben (der Zustand „gespeichert“ bleibt erhalten). */
  private drawChips(): void { this.fillChips(); }

  /** Zahl der gewählten Plugins am Knopf; ohne Plugins, die man wählen könnte, gibt es keinen Knopf (die Chip-Zeile ist dann leer und fehlt ohnehin). */
  private paintToggle(count: number, needed: boolean): void {
    const btn = this.ensureToggle();
    if (!btn) return;
    btn.setText(t("chat.pluginsToggle", String(count)));
    btn.setAttribute("aria-label", t("chat.pluginsToggleLabel", String(count)));
    btn.toggleClass("is-empty", !needed);
  }

  private fillChips(): void {
    const el = this.chipsEl;
    if (!el || !this.endpointOk) return;
    const d = this.deps;
    el.empty();
    el.toggleClass("is-open", this.chipsOpen);
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
    this.paintToggle(d.state.selected.length, d.state.selected.length > 0 || free.length > 0);
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
