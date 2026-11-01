import { describe, expect, it, vi } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";

// Die Verbindung wird mit ihren echten Optionen aufgezeichnet: der Test liest, was `main.ts` ihr übergibt.
const gebaut: Array<Record<string, unknown>> = [];
vi.mock("../src/vendor/kit-obsidian/llm-connection", async (orig) => {
  const m = await orig<typeof import("../src/vendor/kit-obsidian/llm-connection")>();
  return { ...m, createLlmConnection: (o: Record<string, unknown>) => { gebaut.push(o); return m.createLlmConnection(o as never); } };
});
import SettingsAssistantPlugin from "../src/main";

async function lade(gespeichert: unknown) {
  const app = makeFakeApp();
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
  (app as any).plugins = { plugins: {} };
  const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" } as never);
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(gespeichert);
  (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
  (p as unknown as { addChild: () => void }).addChild = () => {};
  await p.onload();
  return p;
}

describe("Stufenwahl im Chat (levelPickerInChat) ist seit Kit 0.73.0 ohne Wirkung", () => {
  it("die Verbindung bietet den Schalter im Anfrage-Abschnitt nicht mehr an (Option levelPicker nicht gesetzt)", async () => {
    gebaut.length = 0;
    await lade({});
    // Messprobe: die Verbindung wurde überhaupt aufgezeichnet, sonst wäre „nicht gesetzt“ nichts wert.
    expect(gebaut.length).toBeGreaterThan(0);
    for (const o of gebaut) expect(o.levelPicker).not.toBe(true);
  });

  it("ein gespeicherter Wert bleibt in der data.json erhalten (nur der Schalter entfällt)", async () => {
    const p = await lade({ request: { levelPickerInChat: true } });
    expect((p as unknown as { settings: { request: { levelPickerInChat: boolean } } }).settings.request.levelPickerInChat).toBe(true);
  });
});
