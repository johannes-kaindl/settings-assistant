import { parseProfile, type ParseResult } from "./profile";
import { redact } from "./secrets";
import type { Json } from "./types";

export interface PluginInfo { id: string; name: string }
export interface BuiltContext { system: string; context: string; redacted: string[]; unreadable: string[] }

/** Drei Backticks, erzeugt statt wörtlich: ein wörtlicher Zaun beendet jeden Markdown-Codeblock, in dem diese Datei zitiert wird. */
const FENCE = "`".repeat(3);

/** Englisch, weil kleine lokale Modelle Anweisungen auf Englisch verlässlicher befolgen; geantwortet wird in der Sprache des Nutzers. */
export const SYSTEM_PROMPT = [
  "You help the user change settings of Obsidian plugins.",
  "You only see the settings listed below. Values shown as \"🔒\" are secrets: never repeat, guess or include them.",
  "Answer briefly, in the user's language.",
  "If a change is needed, add exactly one fenced code block with the language tag settings-profile containing JSON:",
  '{"version":1,"plugins":{"<plugin-id>":{"<key>":<value>}},"notes":{"plugins.<plugin-id>.<key>":"<one sentence why>"}}',
  "Use only plugin ids and keys that appear below. Keep value types exactly (numbers stay numbers, booleans stay booleans).",
  "If you do not know what a key does, say so instead of guessing.",
].join("\n");

export function suggestPlugins(message: string, installed: readonly PluginInfo[]): string[] {
  const m = message.toLowerCase();
  return installed
    .filter((p) => [p.id, p.id.replace(/-/g, " "), p.name].some((s) => s.length >= 3 && m.includes(s.toLowerCase())))
    .map((p) => p.id);
}

export function buildContext(input: { installed: readonly PluginInfo[]; selected: ReadonlyArray<{ id: string; text: string | null }> }): BuiltContext {
  const redacted: string[] = [];
  const unreadable: string[] = [];
  const parts = ["## Installed plugins", ...input.installed.map((p) => `- ${p.id}: ${p.name}`), "", "## Settings"];
  for (const s of input.selected) {
    parts.push(`### plugins.${s.id}`);
    if (s.text === null) { parts.push("(no settings file yet)"); continue; }
    let parsed: Json;
    try { parsed = JSON.parse(s.text) as Json; } catch { unreadable.push(s.id); parts.push("(settings file is not valid JSON)"); continue; }
    const r = redact(parsed);
    for (const p of r.redacted) redacted.push(`plugins.${s.id}.${p}`);
    parts.push(`${FENCE}json`, JSON.stringify(r.value, null, 2), FENCE);
  }
  return { system: SYSTEM_PROMPT, context: parts.join("\n"), redacted, unreadable };
}

const BLOCK = new RegExp(`${FENCE}settings-profile[ \\t]*\\r?\\n([\\s\\S]*?)${FENCE}`, "g");

export function extractProfileBlocks(answer: string): Array<{ raw: string; result: ParseResult }> {
  return [...answer.matchAll(BLOCK)].map((m) => ({ raw: m[1].trim(), result: parseProfile(m[1].trim()) }));
}
