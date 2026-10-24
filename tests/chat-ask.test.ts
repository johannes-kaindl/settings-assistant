import { describe, expect, it } from "vitest";
import { prepareAsk, sentFromMeta, type AskDeps, type SentContext } from "../src/core/chat-ask";
import { extractProfileBlocks } from "../src/core/chat-context";
import { EMPTY_CHAT, addUser, failAnswer, finishAnswer, historyForModel, startAnswer, type ChatHistory, type JsonValue } from "../src/vendor/kit/chat-history";

const SECRET = "sk-geheim-1234567890";
const FILES: Record<string, string> = {
  alpha: JSON.stringify({ theme: "dark", apiKey: SECRET, size: 3 }),
  beta: JSON.stringify({ mode: "x" }),
};
const PROFILE = '```settings-profile\n{"version":1,"plugins":{"alpha":{"size":4}}}\n```';

function deps(over: Partial<AskDeps> = {}): AskDeps {
  return {
    readSettings: async (id) => FILES[id] ?? null,
    installed: () => [{ id: "alpha", name: "Alpha Plugin" }, { id: "beta", name: "Beta" }],
    describeEndpoint: () => ({ endpoint: "http://localhost:1234", model: "m1" }),
    ...over,
  };
}

/** Verlauf wie ihn das Kit-Fenster führt: je Runde Frage + Antwort. `outcome` bestimmt, wie die Runde endet. */
function round(h: ChatHistory, question: string, outcome: { ok: string } | { fail: true } | { open: true }): ChatHistory {
  const user = addUser(h, question);
  const started = startAnswer(user.history);
  if ("ok" in outcome) return finishAnswer(started.history, started.id, { text: outcome.ok });
  if ("fail" in outcome) return failAnswer(started.history, started.id, { kind: "http", status: 500 });
  return started.history;
}

describe("prepareAsk", () => {
  it("(a) baut [system, user(Kontext + Frage)]", async () => {
    const h = round(EMPTY_CHAT, "Make alpha bigger", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps() });
    expect(p.messages.map((m) => m.role)).toEqual(["system", "user"]);
    const user = p.messages[1].content;
    expect(user.endsWith("\n\nMake alpha bigger")).toBe(true);
    expect(user).toContain("### plugins.alpha");
  });

  it("(b)+(i) kein geheimer Wert in Nachrichten, Prompt und Meta; redacted nennt nur Pfade", async () => {
    const h = round(EMPTY_CHAT, "alpha", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps() });
    expect(JSON.stringify(p.messages)).not.toContain(SECRET);
    expect(p.sent.prompt).not.toContain(SECRET);
    expect(JSON.stringify(p.sent.redacted)).not.toContain(SECRET);
    expect(JSON.stringify(p.sent)).not.toContain(SECRET);
    expect(p.sent.prompt).toContain("plugins.alpha");
  });

  it("(c) sent.redacted nennt den Pfad, sent trägt Endpunkt und Modell", async () => {
    const h = round(EMPTY_CHAT, "hi", { open: true });
    const { sent } = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps() });
    expect(sent.redacted).toEqual(["plugins.alpha.apiKey"]);
    expect(sent.plugins).toEqual(["alpha"]);
    expect(sent.endpoint).toBe("http://localhost:1234");
    expect(sent.model).toBe("m1");
  });

  it("(d) Profil-Blöcke der Antwort werden erkannt, nichts wird angewendet", () => {
    const blocks = extractProfileBlocks(`Do this\n${PROFILE}`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].result.ok).toBe(true);
  });

  it("(f) ohne Auswahl wird sie aus der Frage vorgeschlagen, eine vorhandene bleibt", async () => {
    const h = round(EMPTY_CHAT, "change Alpha Plugin please", { open: true });
    const auto = await prepareAsk({ history: historyForModel(h), selected: [], deps: deps() });
    expect(auto.selected).toEqual(["alpha"]);
    expect(auto.sent.plugins).toEqual(["alpha"]);
    const given = await prepareAsk({ history: historyForModel(h), selected: ["beta"], deps: deps() });
    expect(given.selected).toEqual(["beta"]);
  });

  it("(g) zweite Runde: Verlauf ohne Kontext, Kontext nur in der letzten Nutzernachricht", async () => {
    let h = round(EMPTY_CHAT, "first", { ok: "answer1" });
    h = round(h, "second", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps() });
    expect(p.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(p.messages[1].content).toBe("first");
    expect(p.messages[2].content).toBe("answer1");
    expect(p.messages[3].content).toContain("### plugins.alpha");
    expect(p.messages.filter((m) => m.content.includes("## Settings"))).toHaveLength(1);
  });

  it("(g2) eine gescheiterte Runde geht nicht ans Modell", async () => {
    let h = round(EMPTY_CHAT, "first", { fail: true });
    h = round(h, "second", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps() });
    expect(p.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(p.messages[1].content.endsWith("\n\nsecond")).toBe(true);
  });

  it("nicht lesbare Einstellungsdatei: der Wurf wird zu „keine Datei“, kein Wurf nach außen, kein Pfad im Prompt", async () => {
    const h = round(EMPTY_CHAT, "x", { open: true });
    const p = await prepareAsk({
      history: historyForModel(h), selected: ["alpha"],
      deps: deps({ readSettings: async () => { throw new Error("EACCES /secret/path"); } }),
    });
    expect(p.sent.prompt).not.toContain("EACCES");
    expect(p.sent.prompt).toContain("(no settings file yet)");
    expect(p.sent.unreadable).toEqual([]);
  });

  it("eine Datei mit ungültigem JSON steht als unlesbar im Kontext, ohne ihren Inhalt", async () => {
    const h = round(EMPTY_CHAT, "x", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: ["alpha"], deps: deps({ readSettings: async () => '{"apiKey":"sk-halb' }) });
    expect(p.sent.unreadable).toEqual(["alpha"]);
    expect(p.sent.prompt).not.toContain("sk-halb");
  });

  it("ohne Frage am Ende des Verlaufs wirft prepareAsk (kein stilles Senden ohne Frage)", async () => {
    await expect(prepareAsk({ history: [], selected: [], deps: deps() })).rejects.toThrow();
    await expect(prepareAsk({ history: [{ role: "assistant", content: "a" }], selected: [], deps: deps() })).rejects.toThrow();
  });

  it("Endpunkt-Beschreibung darf asynchron sein", async () => {
    const h = round(EMPTY_CHAT, "x", { open: true });
    const p = await prepareAsk({ history: historyForModel(h), selected: [], deps: deps({ describeEndpoint: async () => ({ endpoint: "e", model: "m" }) }) });
    expect(p.sent.endpoint).toBe("e");
  });
});

describe("SentContext als Meta einer Antwort", () => {
  const sent: SentContext = { plugins: ["alpha"], redacted: ["plugins.alpha.apiKey"], unreadable: [], endpoint: "http://x", model: "m", prompt: "p" };

  it("ist ohne Umwandlung als JsonValue ablegbar und kommt unverändert zurück", () => {
    const meta: JsonValue = sent;
    expect(sentFromMeta(JSON.parse(JSON.stringify(meta)))).toEqual(sent);
  });

  it("liest nichts Fremdes: falsche Form ergibt null", () => {
    for (const bad of [undefined, null, 1, "x", [], {}, { ...sent, plugins: "alpha" }, { ...sent, model: 3 }, { ...sent, redacted: [1] }]) {
      expect(sentFromMeta(bad)).toBeNull();
    }
  });
});
