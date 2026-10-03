import { describe, expect, it, vi } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import { prepareLocal, resolveWithPreparedLocal } from "../src/obsidian/local-endpoints";
import type { EndpointConfig } from "../src/vendor/kit/endpoint_config";

const ep = (over: Partial<EndpointConfig> = {}): EndpointConfig => ({ url: "http://127.0.0.1:1234", apiKey: "sk-FAKE-TEST", model: "", ...over });

describe("prepareLocal (Schluesselbund fuer die lokale Endpunkt-Liste)", () => {
  it("liefert hydrierte Configs mit apiKey im Speicher und raeumt settings.endpoints auf", async () => {
    const app = makeFakeApp();
    const settings = { endpoints: [ep()] };
    const save = vi.fn(async () => {});
    const eps = prepareLocal(app, "settings-assistant", settings, save);
    expect(eps[0]?.apiKey).toBe("sk-FAKE-TEST");
    await Promise.resolve();
    expect(JSON.stringify(settings.endpoints)).not.toContain("sk-FAKE-TEST");
    expect(settings.endpoints[0]?.secretId).toBeTruthy();
    expect(settings.endpoints[0]?.id).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("zweiter Aufruf: kein erneutes Speichern, Schluessel weiter hydriert", async () => {
    const app = makeFakeApp();
    const settings = { endpoints: [ep()] };
    const save = vi.fn(async () => {});
    prepareLocal(app, "settings-assistant", settings, save);
    const eps = prepareLocal(app, "settings-assistant", settings, save);
    expect(eps[0]?.apiKey).toBe("sk-FAKE-TEST");
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("resolveWithPreparedLocal", () => {
  it("uebergibt dem Resolver die vorbereitete (hydrierte) Liste, nicht settings.endpoints", async () => {
    const app = makeFakeApp();
    const settings = { endpoints: [ep()] };
    const resolve = vi.fn(async (_i: unknown, _p: unknown) => ({}) as never);
    const ping = async () => true;
    await resolveWithPreparedLocal({ app, pluginId: "settings-assistant", settings, save: async () => {}, input: { capability: "chat" }, ping }, resolve);
    const arg = resolve.mock.calls[0]?.[0] as unknown as { local: EndpointConfig[]; capability: string };
    expect(arg.capability).toBe("chat");
    expect(arg.local).not.toBe(settings.endpoints);
    expect(arg.local[0]?.apiKey).toBe("sk-FAKE-TEST");
    expect(resolve.mock.calls[0]?.[1]).toBe(ping);
  });
});
