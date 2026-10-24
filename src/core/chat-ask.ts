import { buildContext, suggestPlugins, type PluginInfo } from "./chat-context";

/** Was für eine Frage tatsächlich gesendet wurde (Anzeige „Sent context“). `redacted` und `unreadable` nennen nur Pfade/Ids, nie Werte.
 *  Ein `type`-Alias, kein `interface`: nur so ist die Form ohne Umwandlung als `JsonValue` (Meta einer Kit-Antwort) ablegbar. */
export type SentContext = {
  plugins: string[];
  redacted: string[];
  unreadable: string[];
  endpoint: string;
  model: string;
  /** Der volle Text dieser Runde (System-Prompt + Kontext + Frage), wie gesendet — ohne geheime Werte, weil ausschließlich `buildContext` ihn aus den Dateien baut. */
  prompt: string;
};

/** Eine Nachricht des Verlaufs, wie das Kit sie ans Modell gibt (`historyForModel`). Strukturell ein `ChatModelMessage`. */
export interface HistoryMessage { role: string; content: string }
/** Eine Nachricht auf dem Draht. Strukturell ein `ChatWireMessage`. */
export interface WireMessage { role: "system" | "user" | "assistant"; content: string }

export interface AskDeps {
  readSettings(id: string): Promise<string | null>;
  installed(): PluginInfo[];
  describeEndpoint(): { endpoint: string; model: string } | Promise<{ endpoint: string; model: string }>;
}

export interface PreparedAsk {
  messages: WireMessage[];
  sent: SentContext;
  /** Die Auswahl, mit der gesendet wurde (aus der Frage vorgeschlagen, wenn sie leer war). */
  selected: string[];
}

/** Nachrichten je Runde: `[system, …frühere Runden, user(Kontext + "\n\n" + Frage)]`. Frühere Runden tragen nur Frage und Antwort, nie erneut den
 *  Kontext (der aktuelle steht in der letzten Nachricht). Welche früheren Runden dazugehören, entscheidet das Kit: `history` ist `historyForModel`,
 *  also nur abgeschlossene Runden plus die laufende Frage am Ende. */
export async function prepareAsk(input: { history: readonly HistoryMessage[]; selected: readonly string[]; deps: AskDeps }): Promise<PreparedAsk> {
  const { history, deps } = input;
  const last = history[history.length - 1];
  if (last === undefined || last.role !== "user") throw new Error("prepareAsk: the history does not end with a question");
  const question = last.content;
  const installed = deps.installed();
  const ids = input.selected.length > 0 ? [...input.selected] : suggestPlugins(question, installed);
  const selected: Array<{ id: string; text: string | null }> = [];
  for (const id of ids) {
    let text: string | null = null;
    try { text = await deps.readSettings(id); } catch { text = null; }
    selected.push({ id, text });
  }
  const built = buildContext({ installed, selected });
  const userContent = `${built.context}\n\n${question}`;
  const earlier: WireMessage[] = [];
  for (const m of history.slice(0, -1)) if (m.role === "user" || m.role === "assistant") earlier.push({ role: m.role, content: m.content });
  const ep = await deps.describeEndpoint();
  return {
    messages: [{ role: "system", content: built.system }, ...earlier, { role: "user", content: userContent }],
    sent: { plugins: ids, redacted: built.redacted, unreadable: built.unreadable, endpoint: ep.endpoint, model: ep.model, prompt: `${built.system}\n\n${userContent}` },
    selected: ids,
  };
}

function isStringList(v: unknown): v is string[] { return Array.isArray(v) && v.every((x) => typeof x === "string"); }

/** Liest den `SentContext` aus dem Meta einer Antwort zurück; jede andere Form ist `null` (das Meta ist `JsonValue`, nicht vertrauenswürdig typisiert). */
export function sentFromMeta(meta: unknown): SentContext | null {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  const { plugins, redacted, unreadable, endpoint, model, prompt } = m;
  if (!isStringList(plugins) || !isStringList(redacted) || !isStringList(unreadable)) return null;
  if (typeof endpoint !== "string" || typeof model !== "string" || typeof prompt !== "string") return null;
  return { plugins, redacted, unreadable, endpoint, model, prompt };
}
