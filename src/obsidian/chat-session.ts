import { buildContext, extractProfileBlocks, suggestPlugins, type PluginInfo } from "../core/chat-context";
import type { ParseResult } from "../core/profile";
import type { ChatWireMessage } from "../vendor/kit-obsidian/chat-client";

/** Was für eine Frage tatsächlich gesendet wurde (Anzeige „Sent context“). `redacted` und `unreadable` nennen nur Pfade/Ids, nie Werte. */
export interface SentContext {
  plugins: string[];
  redacted: string[];
  unreadable: string[];
  endpoint: string;
  model: string;
  /** Der volle Text dieser Runde (System-Prompt + Kontext + Frage), wie gesendet — ohne geheime Werte, weil ausschließlich `buildContext` ihn aus den Dateien baut. */
  prompt: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  sent?: SentContext;
  /** Vorschläge der Antwort. Sie werden nie automatisch angewendet. */
  blocks?: Array<{ raw: string; result: ParseResult }>;
  /** Nur Fehlercode bzw. `Error.message`, nie Dateiinhalt. */
  error?: string;
}

export interface ChatSessionDeps {
  send(
    messages: ChatWireMessage[], signal: AbortSignal, onDelta: (d: { content?: string; reasoning?: string }) => void,
  ): Promise<{ ok: true; content: string; reasoning?: string } | { ok: false; error: string }>;
  readSettings(id: string): Promise<string | null>;
  installed(): PluginInfo[];
  describeEndpoint(): { endpoint: string; model: string } | Promise<{ endpoint: string; model: string }>;
}

/** Gesprächsverlauf nur im Speicher. Nachrichten je Runde: `[system, …frühere Runden, user(Kontext + "\n\n" + Frage)]`.
 *  Frühere Runden tragen nur Frage und Antwort, nie erneut den Kontext (der aktuelle steht in der letzten Nachricht);
 *  fehlgeschlagene Runden bleiben im Verlauf sichtbar, gehen aber nicht an das Modell. */
export class ChatSession {
  private readonly all: ChatTurn[] = [];
  selected: string[] = [];

  constructor(private readonly deps: ChatSessionDeps) {}

  get turns(): readonly ChatTurn[] { return this.all; }

  suggest(message: string): string[] { return suggestPlugins(message, this.deps.installed()); }

  reset(): void { this.all.length = 0; }

  private history(): ChatWireMessage[] {
    const out: ChatWireMessage[] = [];
    for (let i = 0; i + 1 < this.all.length; i += 2) {
      const u = this.all[i], a = this.all[i + 1];
      if (u.role === "user" && a.role === "assistant" && a.error === undefined) {
        out.push({ role: "user", content: u.content }, { role: "assistant", content: a.content });
      }
    }
    return out;
  }

  async ask(message: string, signal: AbortSignal, onUpdate: () => void): Promise<void> {
    if (this.selected.length === 0) this.selected = this.suggest(message);
    const ids = [...this.selected];
    const selected: Array<{ id: string; text: string | null }> = [];
    for (const id of ids) {
      let text: string | null = null;
      try { text = await this.deps.readSettings(id); } catch { text = null; }
      selected.push({ id, text });
    }
    const built = buildContext({ installed: this.deps.installed(), selected });
    const userContent = `${built.context}\n\n${message}`;
    const messages: ChatWireMessage[] = [{ role: "system", content: built.system }, ...this.history(), { role: "user", content: userContent }];
    const ep = await this.deps.describeEndpoint();
    const sent: SentContext = {
      plugins: ids, redacted: built.redacted, unreadable: built.unreadable,
      endpoint: ep.endpoint, model: ep.model, prompt: `${built.system}\n\n${userContent}`,
    };
    this.all.push({ role: "user", content: message, sent });
    const answer: ChatTurn = { role: "assistant", content: "" };
    this.all.push(answer);
    onUpdate();
    try {
      const res = await this.deps.send(messages, signal, (d) => {
        if (d.content) answer.content += d.content;
        if (d.reasoning) answer.reasoning = (answer.reasoning ?? "") + d.reasoning;
        onUpdate();
      });
      if (res.ok) {
        answer.content = res.content;
        if (res.reasoning) answer.reasoning = res.reasoning;
        const blocks = extractProfileBlocks(res.content);
        if (blocks.length > 0) answer.blocks = blocks;
      } else {
        answer.error = res.error;
      }
    } catch (e) {
      answer.error = signal.aborted || (e instanceof Error && e.name === "AbortError") ? "aborted" : e instanceof Error ? e.message : String(e);
    }
    onUpdate();
  }
}
