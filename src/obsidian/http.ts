// uebernommen aus lingotuner/src/obsidian/http.ts (probeEndpoint, listModels, clientFor), 2026-10-03
import { requestUrl } from "obsidian";
import { classifyEndpointStatus, extractModelIds, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";

export const PROBE_TIMEOUT_MS = 4000;

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

async function send(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Wire> {
  const work = requestUrl({ url, method: "GET", headers, throw: false })
    .then((res) => ({ status: res.status, text: res.text, timedOut: false, error: null }))
    .catch((err: unknown) => ({ status: 0, text: "", timedOut: false, error: err instanceof Error ? err.message : String(err) }));
  const raced = await withTimeout(work, timeoutMs, window);
  return raced.timedOut ? { status: 0, text: "", timedOut: true, error: null } : raced.value;
}

/** Erreichbarkeits-Probe gegen GET /v1/models — mit Schlüssel, sonst meldet ein gehosteter Anbieter 401. */
export async function probeEndpoint(ep: EndpointConfig, timeoutMs: number): Promise<EndpointStatus> {
  const res = await send(`${normalizeEndpoint(ep.url)}/v1/models`, timeoutMs, authHeaders(ep.apiKey));
  if (res.timedOut) return classifyEndpointStatus({ kind: "timeout" });
  if (res.error !== null) return classifyEndpointStatus({ kind: "error", message: res.error });
  let body: unknown = null;
  try { body = JSON.parse(res.text); } catch { /* kein JSON → not-an-llm-api */ }
  return classifyEndpointStatus({ kind: "response", status: res.status, body });
}

export async function listModels(ep: EndpointConfig, timeoutMs: number): Promise<string[]> {
  const res = await send(`${normalizeEndpoint(ep.url)}/v1/models`, timeoutMs, authHeaders(ep.apiKey));
  if (res.timedOut || res.error !== null || res.status < 200 || res.status >= 300) return [];
  try { return extractModelIds(JSON.parse(res.text)).sort(); } catch { return []; }
}

/** EIN Client je Endpunkt-Zeile für die Kit-Endpoint-Liste (Status-Icon UND Modell-Liste). */
export function clientFor(ep: EndpointConfig, timeoutMs: number): { probe(): Promise<EndpointStatus>; listModels(): Promise<string[]> } {
  return { probe: () => probeEndpoint(ep, timeoutMs), listModels: () => listModels(ep, timeoutMs) };
}
