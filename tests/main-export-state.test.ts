import { beforeEach, describe, expect, it, vi } from "vitest";
import { FuzzySuggestModal, Notice, makeFakeApp } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";
import { setLang } from "../src/vendor/kit/i18n";
import { findProfileFences } from "../src/core/profile-fence";
import { parseProfile } from "../src/core/profile";
import { reconcile } from "../src/core/reconcile";

// Die Sprache des Plugins kommt aus `getLanguage()` beim Laden; der Mock liefert immer "en".
const ui = vi.hoisted(() => ({ lang: "en" }));
vi.mock("obsidian", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getLanguage: () => ui.lang }));

const DATA = JSON.stringify({ maxRounds: 20, theme: "dark", apiKey: "sk-LEAK-VALUE" });
type Cmd = { id: string; name: string; callback: () => void };

async function setup(files: Record<string, string>, manifests: Record<string, { id: string; name: string }>) {
  const app = makeFakeApp();
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async (p: string) => p in files, read: async (p: string) => files[p], list: async () => ({ files: [], folders: [] }) };
  (app as any).plugins = { plugins: {}, enabledPlugins: new Set<string>(), manifests };
  const created: Array<{ path: string; text: string }> = [];
  // Eine angelegte Notiz liegt danach im Adapter (wie im echten Vault), damit ein zweites Anlegen den Namen belegt findet.
  (app as any).vault.create = vi.fn(async (path: string, text: string) => { created.push({ path, text }); files[path] = text; return {}; });
  const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" } as never);
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve({});
  (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
  (p as unknown as { addChild: () => void }).addChild = () => {};
  await p.onload();
  const cmd = (p as unknown as { commands: Cmd[] }).commands.find((c) => c.id === "export-plugin-state");
  return { cmd, created };
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));
const notices = (): string[] => Notice.instances.map((n) => String(n.message));

describe("Befehl „Plugin-Stand als Profilnotiz speichern“", () => {
  beforeEach(() => { ui.lang = "en"; setLang("en"); Notice.instances.length = 0; (FuzzySuggestModal as any).__instance = null; });

  it("ist registriert, mit englischem Namen", async () => {
    const { cmd } = await setup({}, {});
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("Save plugin settings as profile note…");
  });

  it("Deutsch: der Name in der Befehlspalette", async () => {
    ui.lang = "de";
    const { cmd } = await setup({}, {});
    expect(cmd!.name).toBe("Plugin-Stand als Profilnotiz speichern…");
  });

  it("legt nach der Wahl eine Notiz ab: ohne Geheimnis, die Pfade zurückgehalten, und gegen denselben Stand geprüft ändert sie nichts", async () => {
    const { cmd, created } = await setup({ ".obsidian/plugins/some-plugin/data.json": DATA }, { "some-plugin": { id: "some-plugin", name: "Some Plugin" } });
    cmd!.callback();
    const modal = (FuzzySuggestModal as any).__instance;
    expect(modal).not.toBeNull();
    expect((modal.getItems() as Array<{ id: string }>).map((i) => i.id)).toEqual(["some-plugin"]);
    modal.__choose(modal.getItems()[0]);
    await settle();
    expect(created).toHaveLength(1);
    expect(created[0].path).toMatch(/^Settings profile \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.md$/);
    expect(created[0].text).not.toContain("LEAK");
    expect(notices().some((m) => m.startsWith("Saved profile note: Settings profile "))).toBe(true);
    expect(notices().some((m) => m === "Some values were withheld before saving: plugins.some-plugin.apiKey")).toBe(true);
    const fence = findProfileFences(created[0].text).find((f) => f.closed)!;
    const parsed = parseProfile(fence.body.trim());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rows = reconcile(parsed.profile, [{ target: { kind: "plugin", id: "some-plugin" }, installed: true, text: DATA }]);
    expect(rows.every((r) => r.status === "same" || r.status === "secret")).toBe(true);
  });

  it("zweimal in derselben Minute: die zweite Notiz bekommt „ 2“, nichts wird überschrieben (Kit createNote, obsidian-kit 0.111.0)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 25, 19, 40, 5));
    try {
      const { cmd, created } = await setup({ ".obsidian/plugins/some-plugin/data.json": DATA }, { "some-plugin": { id: "some-plugin", name: "Some Plugin" } });
      for (let i = 0; i < 2; i++) {
        cmd!.callback();
        const modal = (FuzzySuggestModal as any).__instance;
        modal.__choose(modal.getItems()[0]);
        await settle();
      }
      expect(created.map((c) => c.path)).toEqual(["Settings profile 2026-11-25 19-40.md", "Settings profile 2026-11-25 19-40 2.md"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ein Plugin ohne Einstellungsdatei: Meldung, keine Notiz", async () => {
    const { cmd, created } = await setup({}, { "some-plugin": { id: "some-plugin", name: "Some Plugin" } });
    cmd!.callback();
    const modal = (FuzzySuggestModal as any).__instance;
    modal.__choose(modal.getItems()[0]);
    await settle();
    expect(created).toHaveLength(0);
    expect(notices()).toEqual(["Some Plugin has no settings file yet, so there is nothing to save"]);
  });

  it("eine Datei, die kein JSON ist: nur der Grund, nie ihr Inhalt", async () => {
    const { cmd, created } = await setup({ ".obsidian/plugins/some-plugin/data.json": '{"apiKey": "sk-LEAK-VALUE", oops' }, { "some-plugin": { id: "some-plugin", name: "Some Plugin" } });
    cmd!.callback();
    const modal = (FuzzySuggestModal as any).__instance;
    modal.__choose(modal.getItems()[0]);
    await settle();
    expect(created).toHaveLength(0);
    expect(notices()).toEqual(["The settings file of Some Plugin is not valid JSON"]);
    expect(notices().join("\n")).not.toContain("LEAK");
  });

  it("ohne weitere Plugins: Meldung, kein Dialog; das eigene Plugin steht nie in der Auswahl", async () => {
    const own = await setup({}, { "settings-assistant": { id: "settings-assistant", name: "Settings Assistant" } });
    own.cmd!.callback();
    expect((FuzzySuggestModal as any).__instance).toBeNull();
    expect(notices()).toEqual(["No other plugins are installed"]);
  });
});
