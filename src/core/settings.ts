import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import type { EndpointChoice } from "../vendor/kit/endpoint-source";
import { DEFAULT_GFS_POLICY, type GfsPolicy } from "../vendor/kit/rotation";
import { DEFAULT_REQUEST_SETTINGS, sanitizeRequestSettings, type RequestSettings } from "../vendor/kit/sampling-profiles";
import { mergeSettings } from "../vendor/kit/settings";

export interface SettingsAssistantSettings {
  retention: GfsPolicy;
  endpoints: EndpointConfig[];
  endpointChoice: EndpointChoice;
  localModel: string;
  request: RequestSettings;
}

export const DEFAULT_SETTINGS: SettingsAssistantSettings = {
  retention: DEFAULT_GFS_POLICY,
  endpoints: [],
  endpointChoice: {},
  localModel: "",
  request: DEFAULT_REQUEST_SETTINGS,
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Aufbewahrungswert: ganze Zahl ≥ 0 (0 heißt „keine“); alles andere fällt auf den Default des Feldes zurück. */
export function isValidRetentionValue(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function loadRetention(raw: unknown): GfsPolicy {
  const r = isObj(raw) ? raw : {};
  const pick = (k: keyof GfsPolicy): number => (isValidRetentionValue(r[k]) ? r[k] : DEFAULT_GFS_POLICY[k]);
  return { today: pick("today"), days: pick("days"), weeks: pick("weeks"), months: pick("months") };
}

function loadEndpoints(raw: unknown): EndpointConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: EndpointConfig[] = [];
  for (const e of raw as unknown[]) {
    if (!isObj(e) || typeof e["url"] !== "string" || e["url"].trim() === "") continue;
    out.push({
      url: e["url"],
      ...(typeof e["apiKey"] === "string" ? { apiKey: e["apiKey"] } : {}),
      ...(typeof e["model"] === "string" ? { model: e["model"] } : {}),
    });
  }
  return out;
}

function loadChoice(raw: unknown): EndpointChoice {
  const r = isObj(raw) ? raw : {};
  return {
    ...(typeof r["endpointId"] === "string" && r["endpointId"] !== "" ? { endpointId: r["endpointId"] } : {}),
    ...(typeof r["model"] === "string" && r["model"] !== "" ? { model: r["model"] } : {}),
  };
}

/** Werte prüfen, nicht durchreichen; unbekannte Felder bleiben erhalten (Spec § 12). */
export function loadSettings(raw: unknown): SettingsAssistantSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw) as SettingsAssistantSettings & Record<string, unknown>;
  return {
    ...merged,
    retention: loadRetention(merged.retention),
    endpoints: loadEndpoints(merged.endpoints),
    endpointChoice: loadChoice(merged.endpointChoice),
    localModel: typeof merged.localModel === "string" ? merged.localModel : "",
    request: sanitizeRequestSettings(merged.request).settings,
  };
}
