// uebernommen aus vault-rag/src/chat_view.ts, 2026-10-03
// Uebernommen sind nur Fenster-Aufbau, das `atBottom`-Verhalten (mitscrollen nur, wenn der Nutzer unten ist) und der
// offene Denkschritt waehrend des Streams. Verlauf und Senden liegen in `ChatSession`, nicht hier.
import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { buildStreamArea, type StreamArea } from "../vendor/kit-obsidian/stream-area";
import { buildThinkingControl, type ThinkingControlOptions } from "../vendor/kit-obsidian/thinking-control";
import type { PluginInfo } from "../core/chat-context";
import { redactedProfileNote, profileNoteName } from "../core/profile-note";
import type { ChatSession, ChatTurn, SentContext } from "./chat-session";
import { renderProfileResult, type ProfileResultDeps } from "./profile-block";

export const VIEW_TYPE_SA_CHAT = "settings-assistant-chat";

export interface ChatViewDeps {
  session: ChatSession;
  service: ProfileResultDeps["service"];
  installed(): PluginInfo[];
  /** Löst die Chat-Quelle auf; `true`, wenn ein Endpunkt bereitsteht. */
  resolveEndpoint(): Promise<boolean>;
  openOwnSettings(): void;
  openPluginSettings(id: string): void;
  /** Rendert Markdown in `el` (Obsidian `MarkdownRenderer`); kein innerHTML. */
  renderMarkdown(el: HTMLElement, markdown: string): Promise<void>;
  /** Legt die Notiz an und liefert ihren Pfad. */
  saveNote(name: string, text: string): Promise<string>;
  thinking: Omit<ThinkingControlOptions, "containerEl">;
  now(): Date;
}

const BLOCK_RE = /`{3}settings-profile[ \t]*\r?\n[\s\S]*?`{3}/g;

export class SettingsChatView extends ItemView {
  private endpointOk = false;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private actionBtn: HTMLButtonElement | null = null;
  private thinkCtl: { refresh(): void } | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private turnEls = new Map<ChatTurn, HTMLElement>();
  private finalRendered = new Set<ChatTurn>();

  constructor(leaf: WorkspaceLeaf, private readonly deps: ChatViewDeps) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_SA_CHAT; }
  getDisplayText(): string { return t("chat.title"); }
  getIcon(): string { return "sliders-horizontal"; }

  async onOpen(): Promise<void> {
    try { this.endpointOk = await this.deps.resolveEndpoint(); } catch { this.endpointOk = false; }
    this.refresh();
  }

  onClose(): Promise<void> {
    this.controller?.abort();
    return Promise.resolve();
  }

  /** Baut das Fenster neu auf (Endpunkt, Plugin-Liste oder Sprache können sich geändert haben). */
  refresh(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("sa-chat");
    this.turnEls.clear();
    this.finalRendered.clear();
    this.messagesEl = null; this.inputEl = null; this.chipsEl = null; this.actionBtn = null; this.thinkCtl = null;
    if (!this.endpointOk) {
      const empty = root.createDiv({ cls: "sa-empty" });
      empty.createDiv({ text: t("chat.empty.text") });
      empty.createEl("button", { cls: "mod-cta", text: t("chat.empty.cta") }).addEventListener("click", () => { this.deps.openOwnSettings(); });
      return;
    }
    const head = root.createDiv({ cls: "sa-chat-head" });
    this.thinkCtl = buildThinkingControl({ containerEl: head.createDiv({ cls: "sa-chat-think" }), ...this.deps.thinking });
    head.createEl("button", { text: t("chat.new") }).addEventListener("click", () => { this.newChat(); });
    this.messagesEl = root.createDiv({ cls: "sa-chat-messages" });
    this.buildComposer(root.createDiv({ cls: "sa-chat-composer" }));
    this.update();
  }

  private buildComposer(box: HTMLElement): void {
    this.chipsEl = box.createDiv({ cls: "sa-chat-chips", attr: { "aria-label": t("chat.chips") } });
    this.renderChips();
    const row = box.createDiv({ cls: "sa-chat-input-row" });
    const input = row.createEl("textarea", { cls: "sa-chat-input" });
    input.rows = 3;
    input.placeholder = t("chat.placeholder");
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process" || e.key !== "Enter") return;
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); void this.submit(); }
    });
    this.inputEl = input;
    this.actionBtn = row.createEl("button", { cls: "sa-chat-send mod-cta", text: t("chat.send") });
    this.actionBtn.addEventListener("click", () => {
      if (this.running) this.controller?.abort(); else void this.submit();
    });
  }

  private renderChips(): void {
    const el = this.chipsEl; if (!el) return;
    el.empty();
    const names = new Map(this.deps.installed().map((p) => [p.id, p.name]));
    for (const id of this.deps.session.selected) {
      const chip = el.createSpan({ cls: "sa-chip" });
      chip.createSpan({ cls: "sa-chip-label", text: names.get(id) ?? id });
      const rm = chip.createEl("button", { cls: "sa-chip-remove clickable-icon", attr: { "aria-label": t("chat.remove", id) } });
      setIcon(rm, "x");
      rm.addEventListener("click", () => {
        this.deps.session.selected = this.deps.session.selected.filter((x) => x !== id);
        this.renderChips();
      });
    }
    const free = this.deps.installed().filter((p) => !this.deps.session.selected.includes(p.id));
    if (free.length === 0) return;
    const sel = el.createEl("select", { cls: "dropdown sa-chip-add", attr: { "aria-label": t("chat.addPlugin") } });
    sel.createEl("option", { text: t("chat.addPlugin") }).value = "";
    for (const p of free) sel.createEl("option", { text: p.name }).value = p.id;
    sel.addEventListener("change", () => {
      if (sel.value === "") return;
      this.deps.session.selected = [...this.deps.session.selected, sel.value];
      this.renderChips();
    });
  }

  private newChat(): void {
    if (this.running) return;
    this.deps.session.reset();
    this.turnEls.clear();
    this.finalRendered.clear();
    this.messagesEl?.empty();
    this.update();
  }

  async submit(): Promise<void> {
    if (this.running) return;
    const q = (this.inputEl?.value ?? "").trim();
    if (q === "") return;
    if (this.inputEl) this.inputEl.value = "";
    this.controller = new AbortController();
    this.running = true;
    this.actionBtn?.setText(t("chat.stop"));
    try {
      await this.deps.session.ask(q, this.controller.signal, () => { this.update(); });
    } finally {
      this.running = false;
      this.controller = null;
      this.actionBtn?.setText(t("chat.send"));
      this.renderChips();
      this.update();
    }
  }

  /** Zeichnet nur, was sich ändert: neue Runden anhängen, die laufende Antwort neu aufbauen. */
  private update(): void {
    const box = this.messagesEl; if (!box) return;
    // Scroll-Position VOR dem Umbau merken: nur ans Ende folgen, wenn der Nutzer ohnehin unten war.
    const atBottom = (box.scrollHeight ?? 0) - (box.scrollTop ?? 0) - (box.clientHeight ?? 0) < 40;
    const turns = this.deps.session.turns;
    turns.forEach((turn, i) => {
      let el = this.turnEls.get(turn);
      const fresh = el === undefined;
      if (el === undefined) { el = box.createDiv({ cls: `sa-chat-turn is-${turn.role}` }); this.turnEls.set(turn, el); }
      if (turn.role === "user") { if (fresh) el.createDiv({ cls: "sa-chat-msg", text: turn.content }); return; }
      const live = this.running && i === turns.length - 1;
      if (live || !this.finalRendered.has(turn)) {
        if (!live) this.finalRendered.add(turn);
        el.empty();
        this.renderAnswer(el, turn, live, turns[i - 1]?.sent);
      }
    });
    if (atBottom) box.scrollTop = box.scrollHeight ?? 0;
  }

  private renderAnswer(el: HTMLElement, turn: ChatTurn, live: boolean, sent: SentContext | undefined): void {
    const area: StreamArea = buildStreamArea(el, {
      strings: { reasoning: t("chat.reasoning.live") }, cls: "sa-chat-stream", reasoningOpen: live,
      scrollEl: this.messagesEl ?? undefined, bodyCls: "markdown-rendered",
    });
    if (turn.reasoning) {
      area.setReasoning(turn.reasoning);
      area.setReasoningSummary(live && turn.content === "" ? t("chat.reasoning.live") : t("chat.reasoning.done"));
    }
    if (live) {
      area.setTail(turn.content);
      area.statusEl.setText(t("chat.working"));
      return;
    }
    if (turn.content !== "") {
      const text = turn.content.replace(BLOCK_RE, "").trim();
      if (text !== "") void this.deps.renderMarkdown(area.bodyEl.createDiv({ cls: "okit-stream-block" }), text).catch(() => { area.setTail(text); });
    }
    if (turn.error !== undefined) {
      area.statusEl.setText(turn.error === "aborted" ? t("chat.aborted") : t("chat.error", turn.error));
    }
    (turn.blocks ?? []).forEach((b) => { this.renderBlock(el.createDiv({ cls: "sa-chat-block" }), b, sent?.model ?? ""); });
    if (sent) this.renderSent(el, sent);
  }

  private renderBlock(box: HTMLElement, b: NonNullable<ChatTurn["blocks"]>[number], model: string): void {
    const iso = this.deps.now().toISOString();
    const result = box.createDiv({ cls: "sa-chat-block-result" });
    void renderProfileResult(result, b.result, b.raw, {
      service: this.deps.service, origin: `chat:${iso}/${model}`, openPluginSettings: (id) => { this.deps.openPluginSettings(id); },
    }).catch(() => { /* Fehler zeigt der Dialog; kein Detail in die Ansicht */ });
    if (!b.result.ok) return;
    const profile = b.result.profile;
    const note = box.createDiv({ cls: "sa-chat-block-note" });
    const btn = note.createEl("button", { cls: "sa-chat-save", text: t("chat.save") });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void (async () => {
        try {
          const r = redactedProfileNote(profile);
          const path = await this.deps.saveNote(profileNoteName(this.deps.now()), r.text);
          note.createDiv({ cls: "sa-chat-block-info", text: t("chat.saved", path) });
          if (r.redacted.length > 0) note.createDiv({ cls: "sa-chat-block-info", text: t("chat.saveRedacted", r.redacted.join(", ")) });
        } catch (e) {
          note.createDiv({ cls: "sa-chat-block-info is-error", text: t("chat.saveFailed", e instanceof Error ? e.message : String(e)) });
          btn.disabled = false;
        }
      })();
    });
  }

  /** „Sent context“: nur Namen und Pfade — der Prompt ist bereits geschwärzt (`buildContext`). */
  private renderSent(el: HTMLElement, s: SentContext): void {
    const none = t("chat.ctx.none");
    const list = (a: string[]): string => (a.length > 0 ? a.join(", ") : none);
    const det = el.createEl("details", { cls: "sa-chat-sent" });
    det.createEl("summary", { text: t("chat.ctx.title") });
    det.createDiv({ text: t("chat.ctx.plugins", list(s.plugins)) });
    det.createDiv({ text: t("chat.ctx.redacted", list(s.redacted)) });
    if (s.unreadable.length > 0) det.createDiv({ text: t("chat.ctx.unreadable", s.unreadable.join(", ")) });
    det.createDiv({ text: t("chat.ctx.endpoint", s.endpoint) });
    det.createDiv({ text: t("chat.ctx.model", s.model) });
    det.createDiv({ cls: "sa-chat-sent-label", text: t("chat.ctx.prompt") });
    det.createEl("pre", { cls: "sa-chat-prompt", text: s.prompt });
  }

  /** Nach Änderungen an der Denkstufe in den Einstellungen. */
  refreshThinking(): void { this.thinkCtl?.refresh(); }
}
