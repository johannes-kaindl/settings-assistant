import { afterEach, describe, expect, it } from "vitest";
import { Platform, WorkspaceLeaf, makeFakeApp } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";
import { VIEW_TYPE_SA_CHAT } from "../src/obsidian/chat-host";

// Wo der Befehl „Open settings chat“ den Chat öffnet: auf dem Handy als Tab im Hauptbereich, am Desktop in der rechten Seitenleiste (Welle 29, Daumen-Test).
async function plugin(app: ReturnType<typeof makeFakeApp>): Promise<SettingsAssistantPlugin> {
  (app as any).vault.configDir = ".obsidian";
  (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
  const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "Settings Assistant", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false } as never);
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve({});
  (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
  (p as unknown as { addChild: () => void }).addChild = () => {};
  await p.onload();
  return p;
}
const open = async (p: SettingsAssistantPlugin): Promise<void> => {
  const cmd = (p as unknown as { commands: Array<{ id: string; callback: () => void }> }).commands.find((c) => c.id === "open-chat");
  cmd!.callback();
  await new Promise((r) => setTimeout(r, 10));
};

afterEach(() => { Platform.isMobile = false; });

describe("Befehl „Open settings chat“: Ort der Ansicht", () => {
  it("am Desktop in der rechten Seitenleiste, nie als Tab", async () => {
    const app = makeFakeApp();
    const rechts = { setViewState: async () => {} };
    app.workspace.getRightLeaf = () => rechts;
    let tab = 0;
    app.workspace.getLeaf = () => { tab++; return new WorkspaceLeaf(); };
    app.workspace.revealLeaf = async () => {};
    const p = await plugin(app);
    await open(p);
    expect(tab).toBe(0);
  });

  it("auf dem Handy als Tab im Hauptbereich, nie in der Schublade", async () => {
    Platform.isMobile = true;
    const app = makeFakeApp();
    let rechts = 0;
    app.workspace.getRightLeaf = () => { rechts++; return { setViewState: async () => {} }; };
    const gesetzt: unknown[] = [];
    app.workspace.getLeaf = (art: unknown) => { gesetzt.push(art); return { setViewState: async (v: unknown) => { gesetzt.push(v); } }; };
    app.workspace.revealLeaf = async () => {};
    const p = await plugin(app);
    await open(p);
    expect(rechts).toBe(0);
    expect(gesetzt[0]).toBe("tab");
    expect(gesetzt[1]).toMatchObject({ type: VIEW_TYPE_SA_CHAT });
  });

  it("ein schon geöffneter Chat bleibt, wo er ist (auch auf dem Handy)", async () => {
    Platform.isMobile = true;
    const app = makeFakeApp();
    const vorhanden = { setViewState: async () => { throw new Error("darf nicht neu gesetzt werden"); } };
    app.workspace.getLeavesOfType = () => [vorhanden];
    let neu = 0;
    app.workspace.getLeaf = () => { neu++; return new WorkspaceLeaf(); };
    app.workspace.revealLeaf = async () => {};
    const p = await plugin(app);
    await open(p);
    expect(neu).toBe(0);
  });
});
