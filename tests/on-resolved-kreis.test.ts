import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeFakeApp, WorkspaceLeaf } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";
import { SettingsChatHost, VIEW_TYPE_SA_CHAT } from "../src/obsidian/chat-host";
import { createLlmConnection } from "../src/vendor/kit-obsidian/llm-connection";

// Durchreichen, mit Zugriff auf die Optionen, die das Plugin der Verbindung gibt.
vi.mock("../src/vendor/kit-obsidian/llm-connection", async (orig) => {
  const m = await orig<typeof import("../src/vendor/kit-obsidian/llm-connection")>();
  return { ...m, createLlmConnection: vi.fn(m.createLlmConnection) };
});

// Das Kit-Fenster nimmt seine Uhr aus `window` (Renderer); die Testumgebung ist Node.
beforeAll(() => { vi.stubGlobal("window", globalThis); });

/** Ab dem so vielten `resolve()` liefert der Fake-Manager ein Versprechen, das nie eintritt: der Deckel. Ein Kreis, der nur in Mikrotasks läuft (ein sofort
 *  aufgelöstes Versprechen), käme sonst nie zu einer Makrotask-Runde, und der Test hinge, statt rot zu werden. */
const DECKEL = 50;

const manifest = { id: "settings-assistant", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" };

/** Das Plugin mit einem Manager, der seine `resolve`-Aufrufe zählt, und einer offenen Chat-Ansicht (sonst liefe `refreshChatViews` leer und der Test sähe nie etwas). */
async function openPluginWithChat() {
  const calls = { resolve: 0 };
  const api = {
    version: 1,
    list: () => [],
    get: () => null,
    resolve: () => { calls.resolve++; return calls.resolve > DECKEL ? new Promise<never>(() => {}) : Promise.resolve({ error: "no-endpoint" }); },
    materialize: () => Promise.resolve({ error: "no-endpoint" }),
    models: () => Promise.resolve([]),
    importEndpoints: () => Promise.resolve({ error: "no-endpoint" }),
    on: () => () => {},
  };
  const app = makeFakeApp();
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
  (app as any).plugins = { plugins: { "llm-endpoint-manager": { api } } };
  const leaves: WorkspaceLeaf[] = [];
  (app as any).workspace.getLeavesOfType = (type: string) => (type === VIEW_TYPE_SA_CHAT ? leaves : []);

  const p = new SettingsAssistantPlugin(app as never, manifest as never);
  const loose = p as unknown as Record<string, unknown>;
  loose.loadData = () => Promise.resolve({});
  loose.saveData = () => Promise.resolve();
  loose.addChild = () => {};
  let factory: ((leaf: WorkspaceLeaf) => SettingsChatHost) | undefined;
  loose.registerView = (_type: string, f: typeof factory) => { factory = f; };
  await p.onload();
  expect(factory).toBeDefined();
  const leaf = new WorkspaceLeaf();
  const view = factory!(leaf);
  leaf.view = view;
  leaves.push(leaf);
  await view.onOpen();
  return { p, calls, view, leaves };
}

const runden = async (n: number): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("onResolved der Verbindung bleibt unverdrahtet (Welle 27: refreshChatViews → reload() → llm.resolve() rief es im Kreis)", () => {
  it("nach dem Anfangsschub löst der Manager nicht weiter auf, auch wenn eine Auflösung einen Zug anstößt", async () => {
    const { p, calls, leaves } = await openPluginWithChat();
    await runden(10);
    // Messprobe: die offene Ansicht ist erreichbar und löst beim Neuladen auf (sonst wäre „kein Kreis“ nichts wert).
    expect(leaves.length).toBe(1);
    const vorReload = calls.resolve;
    // Nicht abwarten: bei einem Kreis hinge das Versprechen am Deckel, und der Test soll an der Zahl scheitern, nicht am Zeitlimit.
    void p.refreshChatViews({ models: true });
    await runden(10);
    expect(calls.resolve).toBeGreaterThan(vorReload);

    // Eine Auflösung des Plugins: ein Rückruf an `onResolved`, der mittelbar `resolve()` ruft, ließe die Zahl weiter wachsen.
    void p.resolveEndpoint();
    await runden(10);
    const erst = calls.resolve;
    await runden(10);
    expect(calls.resolve).toBe(erst);
    expect(calls.resolve).toBeLessThan(DECKEL);
  });

  it("ein Aufruf des Rückrufs, falls er gesetzt ist, löst nicht weiter auf", async () => {
    const { calls } = await openPluginWithChat();
    await runden(10);
    const opts = vi.mocked(createLlmConnection).mock.calls.at(-1)![0];
    const vorher = calls.resolve;
    opts.onResolved?.({ config: null, error: "no-endpoint" } as never);
    await runden(10);
    expect(calls.resolve).toBe(vorher);
    expect(calls.resolve).toBeLessThan(DECKEL);
  });
});
