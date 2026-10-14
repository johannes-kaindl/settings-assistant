import { describe, expect, it } from "vitest";
import { Notice, makeFakeApp } from "./vendor/kit/obsidian-mock";
import SettingsAssistantPlugin from "../src/main";
import { setLang } from "../src/vendor/kit/i18n";

describe("Befehl „Undo last apply“", () => {
  it("ohne Schnappschuss meldet er „No snapshots yet“ und öffnet keinen Dialog", async () => {
    const app = makeFakeApp();
    (app as any).vault.configDir = ".obsidian";
    (app as any).vault.adapter = { exists: async () => false, list: async () => ({ files: [], folders: [] }) };
    const p = new SettingsAssistantPlugin(app as never, { id: "settings-assistant", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" } as never);
    (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve({});
    (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
    (p as unknown as { addChild: () => void }).addChild = () => {};   // der Mock-Plugin kennt addChild nicht
    await p.onload();
    setLang("en");
    const cmd = (p as unknown as { commands: Array<{ id: string; callback: () => void }> }).commands.find((c) => c.id === "undo-last-apply");
    expect(cmd).toBeDefined();
    Notice.instances.length = 0;
    cmd!.callback();
    await new Promise((r) => setTimeout(r, 10));
    expect(Notice.instances.map((n) => n.message)).toEqual(["No snapshots yet"]);
  });
});
