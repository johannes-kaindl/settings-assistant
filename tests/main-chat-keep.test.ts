import { describe, expect, it } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";

// Der Verlauf vergangener Chats ist als Vorgabe aus (Entscheidung Johannes, 2026-11-01): was `data.json` nicht oder falsch trägt, schaltet ihn nie ein.
async function laden(data: unknown): Promise<SettingsAssistantPlugin> {
  const app = makeFakeApp();
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
  const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "Settings Assistant", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false } as never);
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
  (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
  (p as unknown as { addChild: () => void }).addChild = () => {};
  await p.onload();
  return p;
}

describe("Aufbewahrung der vergangenen Chats beim Laden", () => {
  it("ohne Eintrag ist der Verlauf aus", async () => { expect((await laden({})).settings.chatKeep).toBe(0); });
  it("ein Eintrag, der keine Zahl ist, schaltet ihn nicht ein (nicht die 50 des Kits)", async () => {
    expect((await laden({ chatKeep: "viel" })).settings.chatKeep).toBe(0);
    expect((await laden({ chatKeep: null })).settings.chatKeep).toBe(0);
  });
  it("eine gültige Zahl bleibt, eine zu große wird auf 500 begrenzt, eine negative auf 0", async () => {
    expect((await laden({ chatKeep: 12 })).settings.chatKeep).toBe(12);
    expect((await laden({ chatKeep: 9999 })).settings.chatKeep).toBe(500);
    expect((await laden({ chatKeep: -3 })).settings.chatKeep).toBe(0);
  });
});
