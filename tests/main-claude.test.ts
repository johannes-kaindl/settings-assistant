import { describe, expect, it } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";

/** Ein Manager, der aufzeichnet, mit welchen Transporten ihn die Verbindung fragt. Ohne Opt-in `transports: { anthropic: true }` sähe das Plugin
 *  einen Endpunkt `provider: "anthropic"` des Managers nie (die Verbindung fragt dann nur nach `http`). */
function managerApp() {
  const asked: Array<{ via: string; transports: unknown }> = [];
  const api = {
    version: 1,
    list: (filter?: { transports?: unknown }) => { asked.push({ via: "list", transports: filter?.transports }); return []; },
    get: () => null,
    resolve: (_capability: string, opts?: { transports?: unknown }) => { asked.push({ via: "resolve", transports: opts?.transports }); return Promise.resolve({ error: "no-endpoint" }); },
    materialize: () => Promise.resolve({ error: "no-endpoint" }),
    models: () => Promise.resolve([]),
    importEndpoints: () => Promise.resolve({ error: "no-endpoint" }),
    on: () => () => {},
  };
  const app = makeFakeApp();
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
  (app as any).plugins = { plugins: { "llm-endpoint-manager": { api } } };
  return { app, asked };
}

describe("Claude als Endpunkt des Endpunkt-Managers", () => {
  it("die Verbindung fragt den Manager auch nach Endpunkten mit Transport „anthropic“", async () => {
    const { app, asked } = managerApp();
    const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" } as never);
    (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve({});
    (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
    (p as unknown as { addChild: () => void }).addChild = () => {};
    await p.onload();
    await p.resolveEndpoint();
    const resolved = asked.filter((a) => a.via === "resolve");
    // Messprobe: der Fake wurde überhaupt gefragt (sonst wäre „nie anthropic“ nichts wert).
    expect(resolved.length).toBeGreaterThan(0);
    for (const a of resolved) expect(a.transports).toEqual(["http", "anthropic"]);
  });
});
