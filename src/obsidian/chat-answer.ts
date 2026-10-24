// uebernommen aus src/obsidian/chat-view.ts (renderBlock, renderSent), Welle 26: das Chat-Fenster ist der Kit-Baustein, das hier ist sein `afterAnswer`.
import { t } from "../vendor/kit/i18n";
import type { ChatAnswerEntry } from "../vendor/kit/chat-history";
import { extractProfileBlocks } from "../core/chat-context";
import { sentFromMeta, type SentContext } from "../core/chat-ask";
import { redactedProfileNote, redactedRawBlock, profileNoteName } from "../core/profile-note";
import { renderProfileResult, type ProfileResultDeps } from "./profile-block";

export interface ChatAnswerDeps {
  service: ProfileResultDeps["service"];
  openPluginSettings(id: string): void;
  /** Legt die Notiz an und liefert ihren Pfad. */
  saveNote(name: string, text: string): Promise<string>;
  now(): Date;
}

type Block = ReturnType<typeof extractProfileBlocks>[number];

/** Das unter einer fertigen Antwort: Vorschlagsblöcke (nie automatisch angewendet) und „Sent context“.
 *  Blöcke gibt es nur bei einer vollständigen Antwort (`done`): das Kit ruft `afterAnswer` auch bei `failed` und `aborted`, und ein Teiltext mit
 *  geschlossenem Zaun dürfte keinen Apply-Knopf zeigen. „Sent context“ steht auch an einer gescheiterten Runde (was wurde gesendet?). */
export function drawAnswerExtras(el: HTMLElement, entry: ChatAnswerEntry, deps: ChatAnswerDeps): void {
  const sent = sentFromMeta(entry.meta);
  if (entry.state === "done") {
    for (const b of extractProfileBlocks(entry.text)) renderBlock(el.createDiv({ cls: "sa-chat-block" }), b, sent?.model ?? "", deps);
  }
  if (sent) renderSent(el, sent);
}

function renderBlock(box: HTMLElement, b: Block, model: string, deps: ChatAnswerDeps): void {
  const iso = deps.now().toISOString();
  const result = box.createDiv({ cls: "sa-chat-block-result" });
  void renderProfileResult(result, b.result, b.raw, {
    service: deps.service, origin: `chat:${iso}/${model}`, openPluginSettings: (id) => { deps.openPluginSettings(id); },
  }).catch(() => { /* Fehler zeigt der Dialog; kein Detail in die Ansicht */ });
  // Spec § 8: der Block ist immer sichtbar — geschwärzt, nie als Rohtext.
  const raw = box.createEl("details", { cls: "sa-chat-raw" });
  raw.createEl("summary", { text: t("chat.raw.title") });
  raw.createEl("pre", { cls: "sa-chat-raw-text", text: redactedRawBlock(b.raw, b.result) ?? t("chat.raw.invalid") });
  if (!b.result.ok) return;
  const profile = b.result.profile;
  const note = box.createDiv({ cls: "sa-chat-block-note" });
  const btn = note.createEl("button", { cls: "sa-chat-save", text: t("chat.save") });
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void (async () => {
      try {
        const r = redactedProfileNote(profile);
        const path = await deps.saveNote(profileNoteName(deps.now()), r.text);
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
function renderSent(el: HTMLElement, s: SentContext): void {
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
