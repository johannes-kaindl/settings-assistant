import { describe, expect, it, vi } from "vitest";
import { createChatSend, resultToSend } from "../src/obsidian/llm";
import type { ChatClient, ChatResult } from "../src/vendor/kit-obsidian/chat-client";

const timing = { startedAt: 0, endedAt: 1 };
const okRes = (content: string): ChatResult => ({ ok: true, content, reasoning: "r", toolCalls: [], truncated: false, streamed: true, timing });

describe("resultToSend", () => {
  it("ok -> content/reasoning", () => {
    expect(resultToSend(okRes("a"))).toEqual({ ok: true, content: "a", reasoning: "r" });
  });
  it("Fehler -> nur Art (und Status), nie Body/Detail", () => {
    const r: ChatResult = { ok: false, kind: "http", detail: "secret detail", partial: "", reasoning: "", status: 401, body: "BODY", timing };
    const out = resultToSend(r);
    expect(out).toEqual({ ok: false, error: "http 401" });
    expect(resultToSend({ ...r, kind: "aborted", status: undefined })).toEqual({ ok: false, error: "aborted" });
  });
});

describe("createChatSend", () => {
  const target = { endpoint: { url: "http://x" }, sentModel: "m", params: { temperature: 0.2 }, family: null, thinking: "off" as const };
  it("sendet über den Client, zeichnet die Parameter auf, streamt Deltas", async () => {
    const complete = vi.fn(async (req: Parameters<ChatClient["complete"]>[0]) => { req.onToken?.("hi"); req.onReasoning?.("th"); return okRes("hi"); });
    const record = vi.fn(); const report = vi.fn();
    const send = createChatSend({ resolve: async () => target, client: () => ({ complete }), recordRequest: record, report });
    const deltas: unknown[] = [];
    const r = await send([{ role: "user", content: "q" }], new AbortController().signal, (d) => deltas.push(d));
    expect(r.ok).toBe(true);
    expect(complete.mock.calls[0][0].model).toBe("m");
    expect(record).toHaveBeenCalledWith({ temperature: 0.2 });
    expect(deltas).toEqual([{ content: "hi" }, { reasoning: "th" }]);
    expect(report).toHaveBeenCalled();
  });
  it("kein Endpunkt -> Fehler, kein Wurf", async () => {
    const send = createChatSend({ resolve: async () => null, client: () => ({ complete: vi.fn() }), recordRequest: vi.fn(), report: vi.fn() });
    expect(await send([], new AbortController().signal, () => {})).toEqual({ ok: false, error: "no-endpoint" });
  });
});
