import type { App } from "obsidian";
import { prepareLocalEndpoints } from "../vendor/kit-obsidian/endpoint-secrets";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { resolveEndpointSource, type EndpointSourceInput, type EndpointSourceResult } from "../vendor/kit/endpoint-source";

/** Lokale Endpunkt-Liste für die Auflösung: migriert Klartext-Schlüssel in den Schlüsselbund, speichert die
 *  bereinigte Liste und liefert hydrierte Kopien (`apiKey` nur im Speicher). Ohne Schlüsselbund bleibt die Liste unverändert. */
export function prepareLocal(app: App, pluginId: string, settings: { endpoints: EndpointConfig[] }, save: () => Promise<void>): EndpointConfig[] {
  return prepareLocalEndpoints({
    app, pluginId, list: settings.endpoints,
    persist: (l) => { settings.endpoints = l; return save(); },
  });
}

/** Löst die Quelle auf und übergibt dabei IMMER die vorbereitete (migrierte, hydrierte) lokale Liste, nie `settings.endpoints` direkt.
 *  `resolve` ist nur für Tests austauschbar. */
export function resolveWithPreparedLocal(
  o: { app: App; pluginId: string; settings: { endpoints: EndpointConfig[] }; save: () => Promise<void>; input: Omit<EndpointSourceInput, "local">; ping: (cfg: EndpointConfig) => Promise<boolean> },
  resolve: typeof resolveEndpointSource = resolveEndpointSource,
): Promise<EndpointSourceResult> {
  return resolve({ ...o.input, local: prepareLocal(o.app, o.pluginId, o.settings, o.save) }, o.ping);
}
