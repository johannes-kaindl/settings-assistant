import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";

import { makeFakeEl, Notice, PluginSettingTab } from "./vendor/kit/obsidian-mock";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { SettingsAssistantSettingTab, type SettingsTabHost } from "../src/obsidian/settings-tab";
import { createLlmConnection, type LlmConnection } from "../src/vendor/kit-obsidian/llm-connection";
import { applyLlmPatch, toLlmSettings } from "../src/core/llm-settings";
import type { SettingsAssistantSettings } from "../src/core/settings";

const PLUGIN = { manifest: { id: "settings-assistant" } } as never;
type FakeEl = ReturnType<typeof makeFakeEl>;

function fakeApp(files: Record<string, string> = {}, withSecrets = false) {
  const adapter = {
    exists: async (p: string) => Object.keys(files).some((k) => k === p || k.startsWith(`${p}/`)),
    read: async (p: string) => files[p] as string,
    list: async (p: string) => {
      const sub = new Set<string>();
      for (const k of Object.keys(files)) if (k.startsWith(`${p}/`)) sub.add(`${p}/${k.slice(p.length + 1).split("/")[0]}`);
      return { files: [] as string[], folders: [...sub] };
    },
  };
  const secrets = new Map<string, string>();
  const secretStorage = { getSecret: (id: string) => secrets.get(id) ?? null, setSecret: (id: string, v: string) => { secrets.set(id, v); } };
  return { vault: { configDir: ".cfg", adapter }, plugins: { plugins: {} }, ...(withSecrets ? { secretStorage } : {}) } as never;
}

/** Die echte Verbindung mit derselben Zuordnung wie `main.ts` — `fakeApp` ist das App-Objekt des Tabs. */
function connection(app: unknown, settings: SettingsAssistantSettings, save: () => Promise<void>): LlmConnection {
  return createLlmConnection({
    app: app as never, pluginId: "settings-assistant", caller: "settings-assistant", capability: "chat", mode: "structured",
    getSettings: () => toLlmSettings(settings),
    persist: (patch) => { applyLlmPatch(settings, patch); return save(); },
  });
}

function host(over: Partial<SettingsTabHost> = {}): SettingsTabHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    llm: { renderSettings: vi.fn(), hideSettings: vi.fn(), invalidate: vi.fn() } as unknown as LlmConnection,
    saveSettings: vi.fn(async () => {}),
    restore: vi.fn(async () => ({ cancelled: true as const })),
    ...over,
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const manifest = (at: string, origin: string) => JSON.stringify({ version: 1, at, origin, files: [{ path: ".cfg/hotkeys.json", existed: true, afterHash: null }] });
const ROOT = ".cfg/plugins/settings-assistant/snapshots";

async function render(h: SettingsTabHost, files: Record<string, string> = {}, withSecrets = false): Promise<{ el: FakeEl; tab: SettingsAssistantSettingTab }> {
  const tab = new SettingsAssistantSettingTab(fakeApp(files, withSecrets), PLUGIN, h);
  const el = makeFakeEl();
  (tab as unknown as { containerEl: FakeEl }).containerEl = el;
  tab.display();
  await flush();
  return { el, tab };
}

beforeEach(() => { Notice.instances.length = 0; });

describe("SettingsAssistantSettingTab", () => {
  it("die Hilfe-Zeile ist das erste Kind des Containers", async () => {
    const { el } = await render(host());
    const first = el.children[0];
    expect(first.hasClass("setting-item")).toBe(true);
    expect(first.__setting.nameValue).toBe("Help");
    expect(first.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("die Verbindung zeichnet Quelle, Liste und Anfrage in einen eigenen Host — nie in den Tab-Container", async () => {
    const h = host();
    const { el } = await render(h);
    const calls = (h.llm.renderSettings as unknown as { mock: { calls: Array<[FakeEl, { lang: string }]> } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).not.toBe(el);
    expect(calls[0]?.[1]).toEqual({ lang: "en" });
  });

  it("es gibt keine globale Modell-Zeile mehr: das Modell lebt nur in der Endpunkt-Zeile (mit und ohne Manager)", async () => {
    const h = host();
    const { el } = await render(h);
    expect(el.querySelectorAll("input").filter((i: FakeEl) => i.getAttribute("aria-label") === "Model")).toHaveLength(0);
    const app = fakeApp();
    (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins["llm-endpoint-manager"] = { api: { version: 1, list: () => [], get: () => null, resolve: async () => ({}), materialize: async () => ({}), models: async () => [], importEndpoints: async () => ({}), on: () => () => {} } };
    const tab = new SettingsAssistantSettingTab(app, PLUGIN, host());
    const el2 = makeFakeEl();
    (tab as unknown as { containerEl: FakeEl }).containerEl = el2;
    tab.display();
    await flush();
    expect(el2.querySelectorAll("input").filter((i: FakeEl) => i.getAttribute("aria-label") === "Model")).toHaveLength(0);
  });

  describe("Haken beim Öffnen (installTabRefreshOnOpen)", () => {
    // Das Mock hat kein `renderTab`; Obsidian 1.14.5 hat es (Vertrag in settings_walker.ts). Der Haken ersetzt es, nur dann ist die Probe nicht leer.
    const proto = PluginSettingTab.prototype as unknown as { renderTab?: () => void };
    const native = (): void => {};
    beforeEach(() => { proto.renderTab = native; });
    afterEach(() => { delete proto.renderTab; });

    it("hide() baut den Haken nicht ab: jedes Öffnen baut weiter neu auf", () => {
      const tab = new SettingsAssistantSettingTab(fakeApp(), PLUGIN, host()) as unknown as SettingsAssistantSettingTab & { renderTab: () => void };
      expect(tab.renderTab).not.toBe(native);
      tab.hide();
      tab.hide();
      expect(tab.renderTab).not.toBe(native);
    });

    it("dispose() (aus onunload) stellt die native Funktion zurück, auch zweimal gerufen", () => {
      const tab = new SettingsAssistantSettingTab(fakeApp(), PLUGIN, host()) as unknown as SettingsAssistantSettingTab & { renderTab: () => void };
      tab.dispose();
      expect(tab.renderTab).toBe(native);
      tab.dispose();
      expect(tab.renderTab).toBe(native);
    });
  });

  it("hide() schließt die Modell-Listen der Verbindung", async () => {
    const h = host();
    const { tab } = await render(h);
    tab.hide();
    expect(h.llm.hideSettings).toHaveBeenCalledTimes(1);
  });

  it("lokale Endpunkt-Zeile über die echte Verbindung: Klartext-Schlüssel wandert in den Schlüsselbund, die Zeile zeigt „saved“", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.endpoints = [{ url: "http://127.0.0.1:1234", apiKey: "sk-FAKE-TAB" }];
    const save = vi.fn(async () => {});
    const app = fakeApp({}, true);
    const h = host({ settings, saveSettings: save, llm: connection(app, settings, save) });
    const tab = new SettingsAssistantSettingTab(app, PLUGIN, h);
    const el = makeFakeEl();
    (tab as unknown as { containerEl: FakeEl }).containerEl = el;
    tab.display();
    await flush();
    const saved = el.querySelectorAll(".okit-ep-secret");
    expect(saved).toHaveLength(1);
    expect(saved[0].textContent).toBe("saved");
    expect(JSON.stringify(settings.endpoints)).not.toContain("sk-FAKE-TAB");
    expect(settings.endpoints[0]?.secretId).toBeTruthy();
    expect(save).toHaveBeenCalled();
  });

  it("ohne Schnappschüsse steht der Empty-State", async () => {
    const { el } = await render(host());
    const empty = el.querySelectorAll(".sa-empty");
    expect(empty).toHaveLength(1);
    expect(empty[0].textContent).toBe("No snapshots yet");
    expect(el.querySelectorAll(".sa-snapshots")).toHaveLength(1);
    expect(el.querySelectorAll(".okit-vlist")).toHaveLength(0);
  });

  it("vier Zahlenfelder für die Aufbewahrung speichern gültige Werte und verwerfen ungültige", async () => {
    const h = host();
    const { el } = await render(h);
    const inputs = el.querySelectorAll("input").filter((i: FakeEl) => i.getAttribute("aria-label")?.startsWith("Keep"));
    expect(inputs).toHaveLength(4);
    const setting = (n: number) => (inputs[n].parentElement.parentElement as FakeEl).__setting;
    const comp = setting(1).components[0];
    comp.onChangeCB?.("3");
    await flush();
    expect(h.settings.retention.days).toBe(3);
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    comp.onChangeCB?.("-2");
    comp.onChangeCB?.("1.5");
    comp.onChangeCB?.("");
    await flush();
    expect(h.settings.retention.days).toBe(3);
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("Schnappschüsse erscheinen neueste zuerst; ein Klick ruft restore mit dem Ordner", async () => {
    const h = host();
    const files = {
      [`${ROOT}/2026-10-01T10-00-00/manifest.json`]: manifest("2026-10-01T10:00:00.000Z", "note:A.md"),
      [`${ROOT}/2026-10-02T10-00-00/manifest.json`]: manifest("2026-10-02T10:00:00.000Z", "chat:x"),
    };
    const { el } = await render(h, files);
    const rows = el.querySelectorAll(".okit-vlist-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("chat:x");
    expect(rows[1].textContent).toContain("note:A.md");
    // Aktionszeilen: kein Umschalter, also weder aria-pressed noch is-active an irgendeiner Zeile (UI-STANDARD §8 Zustands-Knopf)
    for (const r of rows) { expect(r.getAttribute("aria-pressed")).toBeNull(); expect(r.classList?.contains?.("is-active") ?? false).toBe(false); }
    expect(el.querySelectorAll(".sa-empty")).toHaveLength(0);
    rows[0].click();
    expect(h.restore).toHaveBeenCalledWith("2026-10-02T10-00-00");
  });

  it("ein Fehler beim Lesen der Liste zeigt den Empty-State statt zu werfen", async () => {
    const app = fakeApp({ [`${ROOT}/x/manifest.json`]: "{}" }) as { vault: { adapter: { list: () => Promise<never> } } };
    app.vault.adapter.list = async () => { throw new Error("boom"); };
    const tab = new SettingsAssistantSettingTab(app as never, PLUGIN, host());
    const el = makeFakeEl();
    (tab as unknown as { containerEl: FakeEl }).containerEl = el;
    tab.display();
    await flush();
    expect(el.querySelectorAll(".sa-empty")).toHaveLength(1);
  });
});
