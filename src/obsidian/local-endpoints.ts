import type { App } from "obsidian";
import { prepareLocalEndpoints } from "../vendor/kit-obsidian/endpoint-secrets";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";

/** Lokale Endpunkt-Liste für die Auflösung: migriert Klartext-Schlüssel in den Schlüsselbund, speichert die
 *  bereinigte Liste und liefert hydrierte Kopien (`apiKey` nur im Speicher). Ohne Schlüsselbund bleibt die Liste unverändert. */
export function prepareLocal(app: App, pluginId: string, settings: { endpoints: EndpointConfig[] }, save: () => Promise<void>): EndpointConfig[] {
  return prepareLocalEndpoints({
    app, pluginId, list: settings.endpoints,
    persist: (l) => { settings.endpoints = l; return save(); },
  });
}
