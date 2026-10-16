import { describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { createChatSend, resultToSend } from "../src/obsidian/chat-send";
import type { ChatResult } from "../src/vendor/kit-obsidian/chat-client";
import type { LlmConnection, LlmResult } from "../src/vendor/kit-obsidian/llm-connection";

const timing = { startedAt: 0, endedAt: 1 };
const extra = { facts: null, deviations: [], source: {} as never };
const okRes = (content: string): LlmResult => ({ ok: true, content, reasoning: "r", toolCalls: [], truncated: false, streamed: true, timing, ...extra } as ChatResult & typeof extra);

describe("resultToSend", () => {
  it("ok -> content/reasoning", () => {
    expect(resultToSend(okRes("a"))).toEqual({ ok: true, content: "a", reasoning: "r" });
  });
  it("Fehler -> nur Art (und Status), nie Body/Detail des Servers", () => {
    const r = { ok: false, kind: "http", detail: "secret detail", partial: "", reasoning: "", status: 401, body: "BODY", timing, ...extra } as LlmResult;
    expect(resultToSend(r)).toEqual({ ok: false, error: "http 401" });
    expect(resultToSend({ ...r, kind: "aborted", status: undefined } as LlmResult)).toEqual({ ok: false, error: "aborted" });
    expect(resultToSend({ ...r, kind: "truncated", status: undefined } as LlmResult)).toEqual({ ok: false, error: "truncated" });
  });
  it("kein Endpunkt -> eigener Text, nicht der Grund des Managers", () => {
    const r = { ok: false, kind: "no-endpoint", detail: "disabled", partial: "", reasoning: "", timing, ...extra } as LlmResult;
    const out = resultToSend(r);
    expect(out).toEqual({ ok: false, error: "No endpoint available — set one up in the plugin settings." });
  });
});

describe("createChatSend", () => {
  it("fragt die Verbindung, reicht Abbruch und Deltas durch", async () => {
    const complete = vi.fn(async (_req: unknown, h?: { onToken?: (t: string) => void; onReasoning?: (t: string) => void }) => { h?.onToken?.("hi"); h?.onReasoning?.("th"); return okRes("hi"); });
    const send = createChatSend({ complete } as unknown as Pick<LlmConnection, "complete">);
    const ac = new AbortController();
    const deltas: unknown[] = [];
    const r = await send([{ role: "user", content: "q" }], ac.signal, (d) => deltas.push(d));
    expect(r).toEqual({ ok: true, content: "hi", reasoning: "r" });
    expect(complete.mock.calls[0]?.[0]).toEqual({ messages: [{ role: "user", content: "q" }] });
    expect((complete.mock.calls[0]?.[1] as { signal: AbortSignal }).signal).toBe(ac.signal);
    expect(deltas).toEqual([{ content: "hi" }, { reasoning: "th" }]);
  });
  it("onContentReset der Verbindung wird zum Delta resetContent (Gemma 4 ohne Öffner)", async () => {
    const complete = vi.fn(async (_req: unknown, h?: { onToken?: (t: string) => void; onReasoning?: (t: string) => void; onContentReset?: () => void }) => {
      h?.onToken?.("Ich denke."); h?.onContentReset?.(); h?.onReasoning?.("Ich denke."); h?.onToken?.("Antwort"); return okRes("Antwort");
    });
    const deltas: unknown[] = [];
    await createChatSend({ complete } as unknown as Pick<LlmConnection, "complete">)([], new AbortController().signal, (d) => deltas.push(d));
    expect(deltas).toEqual([{ content: "Ich denke." }, { resetContent: true }, { reasoning: "Ich denke." }, { content: "Antwort" }]);
  });
  it("ein Wurf der Verbindung wird zum Fehlerergebnis, ein AbortError zu „aborted“", async () => {
    const boom = createChatSend({ complete: async () => { throw new Error("kaputt"); } } as unknown as Pick<LlmConnection, "complete">);
    expect(await boom([], new AbortController().signal, () => {})).toEqual({ ok: false, error: "kaputt" });
    const abort = createChatSend({ complete: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } } as unknown as Pick<LlmConnection, "complete">);
    expect(await abort([], new AbortController().signal, () => {})).toEqual({ ok: false, error: "aborted" });
  });
});
