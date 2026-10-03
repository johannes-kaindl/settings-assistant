// uebernommen aus lingotuner/src/obsidian/http.ts (chatSetupFor, makeChatClient, cachedProbe) und lingotuner/src/main.ts (Sendepfad, Anfrage-Protokoll), 2026-10-03
import { requestUrl } from "obsidian";
import { createChatClient, type ChatClient, type ChatResult, type ChatWireMessage } from "../vendor/kit-obsidian/chat-client";
import { requestUrlTransport, transportFor, xhrSseTransport, type TransportChoice } from "../vendor/kit-obsidian/chat-transport";
import type { EndpointSourceResult } from "../vendor/kit/endpoint-source";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { probeBaseUrl, probeEndpoint as probeBackend, type CapabilityFetch } from "../vendor/kit/capabilities";
import { checkResponse, type BackendId, type Deviation, type FamilyId, type ThinkingLevel } from "../vendor/kit/sampling-profiles";

/** Idle-Frist des Chat-Clients: Stille seit dem letzten Chunk. */
export const CHAT_IDLE_TIMEOUT_MS = 120_000;
/** Frist bis zum ERSTEN Chunk (JIT-Laden und Reasoning brauchen Minuten). Es gibt dafür noch keine Einstellung. */
export const CHAT_FIRST_CHUNK_TIMEOUT_MS = 300_000;

/** Transportwahl für einen aufgelösten Endpunkt: XHR-Stream, bei Origin-Weigerung einmal ohne Stream über `requestUrl`.
 *  Kurzbefehl-Endpunkte (Apple Intelligence) sind hier nicht verdrahtet — `transportFor` wirft dann, `send` meldet es als Fehler. */
export function chatSetupFor(source: Pick<EndpointSourceResult, "transport"> | null): { choice: TransportChoice; firstChunkMs: number } {
  const choice = transportFor(source ?? {}, { http: xhrSseTransport, httpFallback: requestUrlTransport });
  return { choice, firstChunkMs: CHAT_FIRST_CHUNK_TIMEOUT_MS };
}

/** EIN Chat-Client je Endpunkt. */
export function makeChatClient(source: Pick<EndpointSourceResult, "transport"> | null): ChatClient {
  const { choice, firstChunkMs } = chatSetupFor(source);
  return createChatClient({
    transport: choice.primary, ...(choice.fallback ? { fallbackTransport: choice.fallback } : {}),
    firstChunkTimeoutMs: firstChunkMs, idleTimeoutMs: CHAT_IDLE_TIMEOUT_MS,
  });
}

const fetchJsonAdapter: CapabilityFetch = async (req) => {
  const res = await requestUrl({ url: req.url, method: req.method ?? "GET", headers: req.headers, body: req.body, throw: false });
  if (res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) as unknown }; } catch { return null; }
};

const BACKEND_CACHE_MS = 30_000;
let backendCache: { url: string; backend: BackendId; at: number } | null = null;

/** Welches Backend hinter einer URL steckt — 30 s je URL zwischengespeichert. */
export async function cachedProbe(url: string, model: string): Promise<BackendId | null> {
  if (!/^https?:/i.test(url)) return null;
  const now = Date.now();
  if (backendCache && backendCache.url === url && now - backendCache.at < BACKEND_CACHE_MS) return backendCache.backend;
  const { backend } = await probeBackend(fetchJsonAdapter, probeBaseUrl(url), model);
  backendCache = { url, backend, at: now };
  return backend;
}

export type SendResult = { ok: true; content: string; reasoning?: string } | { ok: false; error: string };
export type ChatSend = (
  messages: ChatWireMessage[], signal: AbortSignal, onDelta: (d: { content?: string; reasoning?: string }) => void,
) => Promise<SendResult>;

/** Fehlertext für die Oberfläche: nur Art und Status — nie `detail`/`body` des Servers (könnten Eingaben spiegeln). */
export function resultToSend(r: ChatResult): SendResult {
  if (r.ok) return { ok: true, content: r.content, ...(r.reasoning !== "" ? { reasoning: r.reasoning } : {}) };
  return { ok: false, error: r.kind === "http" && r.status !== undefined ? `http ${r.status}` : r.kind };
}

export interface ChatTarget {
  endpoint: EndpointConfig;
  /** Das Modell, wie es gesendet wird (`sentModel`). */
  sentModel: string;
  params: Record<string, number | string>;
  family: FamilyId | null;
  thinking: ThinkingLevel;
}

export interface ChatSendDeps {
  resolve(): Promise<ChatTarget | null>;
  client(target: ChatTarget): ChatClient;
  recordRequest(params: Record<string, unknown>): void;
  report(ds: Deviation[]): void;
}

/** Baut die `send`-Funktion für `ChatSession`. Fehler werden zu `{ok:false}`, nur ein Abbruch/Wurf des Aufrufers bleibt dessen Sache. */
export function createChatSend(deps: ChatSendDeps): ChatSend {
  return async (messages, signal, onDelta) => {
    const target = await deps.resolve();
    if (target === null) return { ok: false, error: "no-endpoint" };
    deps.recordRequest(target.params);
    let result: ChatResult;
    try {
      // client() liegt im try: ein nicht verdrahteter Transport (Kurzbefehl) wirft dort.
      result = await deps.client(target).complete({
        endpoint: target.endpoint, model: target.sentModel, messages, params: target.params, signal,
        onToken: (text) => { onDelta({ content: text }); },
        onReasoning: (text) => { onDelta({ reasoning: text }); },
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "aborted" : e instanceof Error ? e.message : String(e) };
    }
    const facts = result.ok
      ? { status: 200, finishReason: result.finishReason ?? null, content: result.content, reasoning: result.reasoning, ...(result.model !== undefined ? { responseModel: result.model } : {}) }
      : result.kind === "http" && result.status !== undefined ? { status: result.status, errorText: result.detail, content: "", reasoning: result.reasoning }
      : null;
    if (facts) deps.report(checkResponse({ family: target.family, thinking: target.thinking }, facts));
    return resultToSend(result);
  };
}
