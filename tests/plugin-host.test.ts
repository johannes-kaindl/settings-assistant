import { describe, expect, it, vi } from "vitest";
import { disablePlugin, enablePlugin, installedPlugins, isInstalled, isPluginEnabled } from "../src/obsidian/plugin-host";

const appWith = (plugins: Record<string, unknown>, enabled: string[], manifests: Record<string, unknown> = {}) =>
  ({ plugins: { plugins, enabledPlugins: new Set(enabled), disablePlugin: vi.fn(), enablePlugin: vi.fn(), manifests } }) as never;

describe("plugin-host", () => {
  it("enabled = loaded OR persisted", () => {
    expect(isPluginEnabled(appWith({ a: {} }, []), "a")).toBe(true);
    expect(isPluginEnabled(appWith({}, ["a"]), "a")).toBe(true);
    expect(isPluginEnabled(appWith({}, []), "a")).toBe(false);
  });
  it("never cycles itself", async () => {
    await expect(disablePlugin(appWith({}, []), "settings-assistant")).rejects.toThrow("self");
    await expect(enablePlugin(appWith({}, []), "settings-assistant")).rejects.toThrow("self");
    await expect(disablePlugin(appWith({}, []), "Settings-Assistant")).rejects.toThrow("self");
    await expect(enablePlugin(appWith({}, []), "SETTINGS-ASSISTANT")).rejects.toThrow("self");
  });
  it("(M7) lists installed plugins without itself in any case", () => {
    const app = appWith({}, [], { a: { id: "a", name: "A" }, X: { id: "Settings-Assistant", name: "S" } });
    expect(installedPlugins(app)).toEqual([{ id: "a", name: "A" }]);
  });
  it("delegates to the manager for other plugins", async () => {
    const app = appWith({}, []);
    await disablePlugin(app, "x");
    await enablePlugin(app, "x");
    const m = (app as unknown as { plugins: { disablePlugin: ReturnType<typeof vi.fn>; enablePlugin: ReturnType<typeof vi.fn> } }).plugins;
    expect(m.disablePlugin).toHaveBeenCalledWith("x");
    expect(m.enablePlugin).toHaveBeenCalledWith("x");
  });
  it("lists installed plugins without itself", () => {
    const app = appWith({}, [], { a: { id: "a", name: "A" }, "settings-assistant": { id: "settings-assistant", name: "S" } });
    expect(installedPlugins(app)).toEqual([{ id: "a", name: "A" }]);
    expect(isInstalled(app, "a")).toBe(true);
    expect(isInstalled(app, "b")).toBe(false);
  });
  it("treats prototype names as neither installed nor enabled (I1)", () => {
    const app = appWith({}, [], { a: { id: "a", name: "A" } });
    for (const id of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(isInstalled(app, id)).toBe(false);
      expect(isPluginEnabled(app, id)).toBe(false);
    }
  });
  it("is defensive when app.plugins is missing", async () => {
    const app = {} as never;
    expect(isPluginEnabled(app, "a")).toBe(false);
    expect(installedPlugins(app)).toEqual([]);
    await expect(disablePlugin(app, "a")).resolves.toBeUndefined();
  });
});
