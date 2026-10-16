import { describe, expect, it, vi } from "vitest";
import { ChatSession, type ChatSessionDeps } from "../src/obsidian/chat-session";
import type { ChatWireMessage } from "../src/vendor/kit-obsidian/chat-client";

const SECRET = "sk-geheim-1234567890";
const FILES: Record<string, string> = {
  alpha: JSON.stringify({ theme: "dark", apiKey: SECRET, size: 3 }),
  beta: JSON.stringify({ mode: "x" }),
};
const PROFILE = '```settings-profile\n{"version":1,"plugins":{"alpha":{"size":4}}}\n```';

type Send = ChatSessionDeps["send"];
function make(send: Send, over: Partial<ChatSessionDeps> = {}): ChatSession {
  return new ChatSession({
    send,
    readSettings: async (id) => FILES[id] ?? null,
    installed: () => [{ id: "alpha", name: "Alpha Plugin" }, { id: "beta", name: "Beta" }],
    describeEndpoint: () => ({ endpoint: "http://localhost:1234", model: "m1" }),
    ...over,
  });
}
const ok = (content: string): Send => async (_m, _s, onDelta) => { onDelta({ content }); return { ok: true, content }; };

describe("ChatSession", () => {
  it("(a) baut [system, user(context + message)]", async () => {
    const calls: ChatWireMessage[][] = [];
    const s = make(async (m) => { calls.push([...m]); return { ok: true, content: "hi" }; });
    s.selected = ["alpha"];
    await s.ask("Make alpha bigger", new AbortController().signal, () => {});
    expect(calls[0].map((m) => m.role)).toEqual(["system", "user"]);
    const user = calls[0][1].content as string;
    expect(user.endsWith("\n\nMake alpha bigger")).toBe(true);
    expect(user).toContain("### plugins.alpha");
  });

  it("(b)+(i) kein geheimer Wert im Prompt, redacted nennt nur Pfade", async () => {
    const wire: string[] = [];
    const s = make(async (m) => { wire.push(JSON.stringify(m)); return { ok: true, content: "x" }; });
    s.selected = ["alpha"];
    await s.ask("alpha", new AbortController().signal, () => {});
    const sent = s.turns[0].sent!;
    expect(wire.join()).not.toContain(SECRET);
    expect(sent.prompt).not.toContain(SECRET);
    expect(JSON.stringify(sent.redacted)).not.toContain(SECRET);
    expect(JSON.stringify(s.turns)).not.toContain(SECRET);
    expect(sent.prompt).toContain("plugins.alpha");
  });

  it("(c) sent.redacted nennt den Pfad, sent trägt Endpunkt/Modell", async () => {
    const s = make(ok("x"));
    s.selected = ["alpha"];
    await s.ask("hi", new AbortController().signal, () => {});
    const sent = s.turns[0].sent!;
    expect(sent.redacted).toEqual(["plugins.alpha.apiKey"]);
    expect(sent.plugins).toEqual(["alpha"]);
    expect(sent.endpoint).toBe("http://localhost:1234");
    expect(sent.model).toBe("m1");
  });

  it("(d) Profil-Blöcke der Antwort landen in turn.blocks, ohne Anwendung", async () => {
    const s = make(ok(`Do this\n${PROFILE}`));
    s.selected = ["alpha"];
    await s.ask("x", new AbortController().signal, () => {});
    const a = s.turns[1];
    expect(a.role).toBe("assistant");
    expect(a.blocks).toHaveLength(1);
    expect(a.blocks![0].result.ok).toBe(true);
  });

  it("(e) Fehler von send landet in turn.error, kein Wurf, nur Message", async () => {
    const s = make(async () => ({ ok: false, error: "http 500" }));
    s.selected = ["alpha"];
    await expect(s.ask("x", new AbortController().signal, () => {})).resolves.toBeUndefined();
    expect(s.turns[1].error).toBe("http 500");
    const t = make(async () => { throw new Error("boom"); });
    t.selected = ["alpha"];
    await t.ask("x", new AbortController().signal, () => {});
    expect(t.turns[1].error).toBe("boom");
    expect(JSON.stringify(t.turns[1])).not.toContain(SECRET);
  });

  it("(f) selected wird beim ersten ask aus suggest vorbelegt, wenn leer", async () => {
    const s = make(ok("x"));
    expect(s.suggest("change Alpha Plugin please")).toEqual(["alpha"]);
    await s.ask("change Alpha Plugin please", new AbortController().signal, () => {});
    expect(s.selected).toEqual(["alpha"]);
    expect(s.turns[0].sent!.plugins).toEqual(["alpha"]);
    const t = make(ok("x"));
    t.selected = ["beta"];
    await t.ask("change Alpha Plugin", new AbortController().signal, () => {});
    expect(t.selected).toEqual(["beta"]);
  });

  it("(g) zweite Runde: Verlauf ohne Kontext, Kontext nur in der letzten Nutzernachricht", async () => {
    const calls: ChatWireMessage[][] = [];
    let n = 0;
    const s = make(async (m) => { calls.push([...m]); n++; return { ok: true, content: `answer${n}` }; });
    s.selected = ["alpha"];
    await s.ask("first", new AbortController().signal, () => {});
    await s.ask("second", new AbortController().signal, () => {});
    expect(calls[1].map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(calls[1][1].content).toBe("first");
    expect(calls[1][2].content).toBe("answer1");
    expect((calls[1][3].content as string)).toContain("### plugins.alpha");
    expect(calls[1].filter((m) => String(m.content).includes("## Settings"))).toHaveLength(1);
  });

  it("(g2) fehlgeschlagene Runde kommt nicht in den Verlauf", async () => {
    const calls: ChatWireMessage[][] = [];
    let n = 0;
    const s = make(async (m) => { calls.push([...m]); n++; return n === 1 ? { ok: false, error: "x" } : { ok: true, content: "y" }; });
    s.selected = ["alpha"];
    await s.ask("first", new AbortController().signal, () => {});
    await s.ask("second", new AbortController().signal, () => {});
    expect(calls[1].map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("(h) Abbruch ergibt turn.error 'aborted', kein Wurf", async () => {
    const ac = new AbortController();
    const s = make(async (_m, signal) => { ac.abort(); if (signal.aborted) { const e = new Error("The operation was aborted"); e.name = "AbortError"; throw e; } return { ok: true, content: "" }; });
    s.selected = ["alpha"];
    await s.ask("x", ac.signal, () => {});
    expect(s.turns[1].error).toBe("aborted");
  });

  it("Deltas aktualisieren die Antwort und rufen onUpdate; reset leert", async () => {
    const onUpdate = vi.fn();
    const s = make(async (_m, _s, onDelta) => { onDelta({ reasoning: "r" }); onDelta({ content: "ab" }); onDelta({ content: "c" }); return { ok: true, content: "abc", reasoning: "r" }; });
    s.selected = ["alpha"];
    await s.ask("x", new AbortController().signal, onUpdate);
    expect(s.turns[1].content).toBe("abc");
    expect(s.turns[1].reasoning).toBe("r");
    expect(onUpdate).toHaveBeenCalled();
    s.reset();
    expect(s.turns).toHaveLength(0);
  });

  it("resetContent leert den gestreamten Antworttext, das Denken bleibt (Gemma 4 ohne Öffner)", async () => {
    const seen: string[] = [];
    const s = make(async (_m, _s, onDelta) => {
      onDelta({ content: "Ich denke." }); seen.push(s.turns[1].content);
      onDelta({ resetContent: true }); seen.push(s.turns[1].content);
      onDelta({ reasoning: "Ich denke." }); onDelta({ content: "Antwort" }); seen.push(s.turns[1].content);
      return { ok: true, content: "Antwort", reasoning: "Ich denke." };
    });
    s.selected = ["alpha"];
    await s.ask("x", new AbortController().signal, () => {});
    expect(seen).toEqual(["Ich denke.", "", "Antwort"]);
    expect(s.turns[1].reasoning).toBe("Ich denke.");
  });

  it("nicht lesbare Einstellungsdatei: Fehler beim Lesen wird zu 'keine Datei', kein Wurf", async () => {
    const s = make(ok("x"), { readSettings: async () => { throw new Error("EACCES /secret/path"); } });
    s.selected = ["alpha"];
    await s.ask("x", new AbortController().signal, () => {});
    expect(s.turns[1].error).toBeUndefined();
    expect(s.turns[0].sent!.prompt).not.toContain("EACCES");
  });
});
