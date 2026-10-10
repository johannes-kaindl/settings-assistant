import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import type { EndpointChoice } from "../vendor/kit/endpoint-source";
import type { RequestSettings } from "../vendor/kit/sampling-profiles";
import type { SettingsAssistantSettings } from "./settings";

/** Die Form, in der die Verbindung (`createLlmConnection`) Settings liest und schreibt. Unsere Felder heißen
 *  `endpointChoice`, die der Verbindung `choice`. Ein globales Modell gibt es nicht (das Modell lebt nur in der
 *  Endpunkt-Zeile): ohne `model` in dieser Sicht entfällt in der Zeilenauswahl die Option „global model“. */
export interface LlmSettingsView {
  endpoints: EndpointConfig[];
  choice: EndpointChoice;
  request: RequestSettings;
}

export function toLlmSettings(s: SettingsAssistantSettings): LlmSettingsView {
  return { endpoints: s.endpoints, choice: s.endpointChoice, request: s.request };
}

/** Übernimmt den Patch der Verbindung SYNCHRON in die Settings (sie liest ihre Zeilen gleich danach zurück). */
export function applyLlmPatch(s: SettingsAssistantSettings, patch: Partial<LlmSettingsView>): void {
  if (patch.endpoints !== undefined) s.endpoints = patch.endpoints;
  if (patch.choice !== undefined) s.endpointChoice = patch.choice;
  if (patch.request !== undefined) s.request = patch.request;
}
