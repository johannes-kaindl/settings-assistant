import type { ChatWireMessage } from "../vendor/kit-obsidian/chat-client";
import type { LlmConnection, LlmResult } from "../vendor/kit-obsidian/llm-connection";
import { t } from "../vendor/kit/i18n";

export type SendResult = { ok: true; content: string; reasoning?: string } | { ok: false; error: string };
export type ChatSend = (
  messages: ChatWireMessage[], signal: AbortSignal, onDelta: (d: { content?: string; reasoning?: string; resetContent?: boolean }) => void,
) => Promise<SendResult>;

/** Fehlertext für die Oberfläche: nur Art und Status — nie `detail`/`body` des Servers (könnten Eingaben spiegeln). */
export function resultToSend(r: LlmResult): SendResult {
  if (r.ok) return { ok: true, content: r.content, ...(r.reasoning !== "" ? { reasoning: r.reasoning } : {}) };
  if (r.kind === "no-endpoint") return { ok: false, error: t("error.noEndpoint") };
  return { ok: false, error: r.kind === "http" && r.status !== undefined ? `http ${r.status}` : r.kind };
}

/** Baut die `send`-Funktion für `ChatSession` über die Verbindung. Fehler werden zu `{ok:false}`; Auflösung, Parameter,
 *  Prüfung der Antwort und Anfrage-Protokoll liegen in `llm.complete`. */
export function createChatSend(llm: Pick<LlmConnection, "complete">): ChatSend {
  return async (messages, signal, onDelta) => {
    try {
      const r = await llm.complete({ messages }, {
        signal,
        onToken: (text) => { onDelta({ content: text }); },
        onReasoning: (text) => { onDelta({ reasoning: text }); },
        // Gemma 4 ohne Öffner: der bisher gezeigte Antworttext war das Denken (kommt über `onReasoning`) — die Anzeige wird geleert.
        onContentReset: () => { onDelta({ resetContent: true }); },
      });
      return resultToSend(r);
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "aborted" : e instanceof Error ? e.message : String(e) };
    }
  };
}
