import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { makeFakeEl, Notice } from "./vendor/kit/obsidian-mock";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { SettingsAssistantSettingTab, type SettingsTabHost } from "../src/obsidian/settings-tab";
import { createRequestSession } from "../src/vendor/kit-obsidian/request-session";

type FakeEl = ReturnType<typeof makeFakeEl>;

function fakeApp(files: Record<string, string> = {}) {
  const adapter = {
    exists: async (p: string) => Object.keys(files).some((k) => k === p || k.startsWith(`${p}/`)),
    read: async (p: string) => files[p] as string,
    list: async (p: string) => {
      const sub = new Set<string>();
      for (const k of Object.keys(files)) if (k.startsWith(`${p}/`)) sub.add(`${p}/${k.slice(p.length + 1).split("/")[0]}`);
      return { files: [] as string[], folders: [...sub] };
    },
  };
  return { vault: { configDir: ".cfg", adapter }, plugins: { plugins: {} } } as never;
}

function host(over: Partial<SettingsTabHost> = {}): SettingsTabHost {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn(async () => {}),
    saveRequestSettings: vi.fn(async () => {}),
    requestSession: createRequestSession({ message: () => "" }),
    requestSectionState: () => ({ family: null, familySource: "none", backend: "unknown", backendSource: "none", model: "", sentModel: "" }),
    resolveEndpoint: vi.fn(async () => null),
    invalidateEndpointCache: vi.fn(),
    activeEndpointUrl: () => null,
    restore: vi.fn(async () => ({ cancelled: true as const })),
    ...over,
  };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const manifest = (at: string, origin: string) => JSON.stringify({ version: 1, at, origin, files: [{ path: ".cfg/hotkeys.json", existed: true, afterHash: null }] });
const ROOT = ".cfg/plugins/settings-assistant/snapshots";

async function render(h: SettingsTabHost, files: Record<string, string> = {}): Promise<{ el: FakeEl; tab: SettingsAssistantSettingTab }> {
  const tab = new SettingsAssistantSettingTab(fakeApp(files), {} as never, h);
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
    expect(el.querySelectorAll(".sa-empty")).toHaveLength(0);
    rows[0].click();
    expect(h.restore).toHaveBeenCalledWith("2026-10-02T10-00-00");
  });

  it("ein Fehler beim Lesen der Liste zeigt den Empty-State statt zu werfen", async () => {
    const app = fakeApp({ [`${ROOT}/x/manifest.json`]: "{}" }) as { vault: { adapter: { list: () => Promise<never> } } };
    app.vault.adapter.list = async () => { throw new Error("boom"); };
    const tab = new SettingsAssistantSettingTab(app as never, {} as never, host());
    const el = makeFakeEl();
    (tab as unknown as { containerEl: FakeEl }).containerEl = el;
    tab.display();
    await flush();
    expect(el.querySelectorAll(".sa-empty")).toHaveLength(1);
  });
});
