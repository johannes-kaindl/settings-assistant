// Jeder in src/ verwendete String-Schlüssel existiert in beiden Sprachen (M2). Gelesen wird der Quelltext, nicht die
// Laufzeit: `t("…")`/`tn("…")` mit Literal, die Schlüssel-Tabellen `*_KEY`, und für Vorlagen-Schlüssel
// (`t(\`status.${…}\`)`) die geschlossenen Wertemengen aus den Typen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings";
import { FIELD_ORDER, THINKING_LEVELS } from "../src/vendor/kit/sampling-profiles";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "vendor" ? [] : sources(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = sources(join(__dirname, "..", "src")).filter((p) => !p.endsWith(join("i18n", "strings.ts")));
const TEXT = SRC.map((p) => readFileSync(p, "utf8")).join("\n");

function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of TEXT.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]);
  for (const m of TEXT.matchAll(/\btn\(\s*"([^"]+)"/g)) { keys.add(`${m[1]}.one`); keys.add(`${m[1]}.many`); }
  for (const block of TEXT.matchAll(/[A-Z_]+_KEY\b[^=]*=\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/:\s*"([^"]+)"/g)) keys.add(m[1]);
  }
  return keys;
}

/** Vorlagen-Schlüssel mit geschlossener Wertemenge (Typen in src/core und im Kit). */
const TEMPLATE_KEYS: string[] = [
  ...["change", "same", "missing-key", "not-installed", "unreadable", "shape-conflict", "secret", "read-only"].map((s) => `status.${s}`),
  ...["written", "corrected", "skipped", "changed-meanwhile", "error"].map((s) => `outcome.${s}`),
  ...["restored", "changed-since", "unverified", "error", "skipped"].map((s) => `restore.outcome.${s}`),
  ...["restore", "changed", "unverified"].map((s) => `restore.state.${s}`),
  ...["invalid-json", "not-object", "missing-version", "bad-version", "future-version", "bad-section"].map((s) => `profile.err.${s}`),
  ...THINKING_LEVELS.map((l) => `request.level.${l}`),
];

const read = (rel: string): string => readFileSync(join(__dirname, "..", rel), "utf8");

/** Schlüssel, die `settings-tab.ts` in Inline-Tabellen (`{ "sent-effective": "request.state.sentEffective" }`) führt. */
function inlineTableKeys(): string[] {
  return [...read("src/obsidian/settings-tab.ts").matchAll(/:\s*"(request\.(?:state|note)\.[A-Za-z]+)"/g)].map((m) => m[1]);
}
/** Wertemengen, die nur als Typ bzw. Konstante im Quelltext stehen (nicht über `*_KEY`/Literal-Aufruf sichtbar). */
function typeUnion(src: string, name: string): string[] {
  const m = new RegExp(`export type ${name} = ([^;]+);`).exec(src);
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [];
}
/** Die Betriebsarten, für die der Tab Überschriften baut (`modes: [CHAT_MODE]`), aufgelöst über die Konstante. */
function chatModes(): string[] {
  const src = read("src/obsidian/settings-tab.ts");
  const m = /CHAT_MODE[^=\n]*=\s*"([^"]+)"/.exec(src);
  return m && /modes:\s*\[CHAT_MODE\]/.test(src) ? [m[1]] : [];
}
function retentionFields(): string[] {
  const m = /RETENTION_FIELDS[^=]*=\s*\[([^\]]*)\]/.exec(read("src/obsidian/settings-tab.ts"));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}
const MODEL_HINTS = typeUnion(read("src/vendor/kit/model-choice.ts"), "ModelHintKey").filter((k) => k !== "");
const FAMILY_SOURCES = ["manager", "name", "none"];
const BACKEND_SOURCES = ["manager", "probe", "none"];

describe("String-Abdeckung", () => {
  it("Probe der Wertemengen-Leser (leere Menge wäre ein stilles Grün)", () => {
    expect(inlineTableKeys().length).toBe(10);
    expect(retentionFields()).toEqual(["today", "days", "weeks", "months"]);
    expect(chatModes()).toEqual(["structured"]);
    expect(MODEL_HINTS.length).toBeGreaterThanOrEqual(2);
    expect(FIELD_ORDER.length).toBeGreaterThanOrEqual(7);
  });
  it("Inline-Tabellen und dynamisch zusammengesetzte Schlüssel existieren in beiden Sprachen", () => {
    const keys = [
      ...inlineTableKeys(),
      ...chatModes().map((m) => `request.mode.${m}`),
      ...FIELD_ORDER.map((f) => `request.field.${f}`),
      ...retentionFields().map((f) => `set.retention.${f}`),
      ...MODEL_HINTS.map((h) => `set.modelHint.${h}`),
      ...FAMILY_SOURCES.map((s) => `request.familySource.${s}`),
      ...BACKEND_SOURCES.map((s) => `request.backendSource.${s}`),
    ];
    const en = STRINGS.en as Record<string, string>;
    const de = STRINGS.de as Record<string, string>;
    expect(keys.filter((k) => en[k] === undefined || de[k] === undefined)).toEqual([]);
  });
  it("en und de haben dieselben Schlüssel", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });
  it("findet überhaupt Schlüssel im Quelltext (Probe des Parsers)", () => {
    const keys = usedKeys();
    expect(keys.has("chat.save")).toBe(true);
    expect(keys.has("modal.apply.one")).toBe(true);
    expect(keys.has("ep.status.ok")).toBe(true);
    expect(keys.size).toBeGreaterThan(80);
  });
  it("jeder Literal-Schlüssel aus src/ existiert in beiden Sprachen", () => {
    const en = STRINGS.en as Record<string, string>;
    const de = STRINGS.de as Record<string, string>;
    const missing = [...usedKeys()].filter((k) => en[k] === undefined || de[k] === undefined);
    expect(missing).toEqual([]);
  });
  it("jeder Vorlagen-Schlüssel mit geschlossener Wertemenge existiert in beiden Sprachen", () => {
    const en = STRINGS.en as Record<string, string>;
    const de = STRINGS.de as Record<string, string>;
    expect(TEMPLATE_KEYS.filter((k) => en[k] === undefined || de[k] === undefined)).toEqual([]);
  });
  it("jedes Präfix einer Vorlage hat mindestens einen Schlüssel", () => {
    const prefixes = [...TEXT.matchAll(/\bt\(\s*`([a-zA-Z.-]+)\.\$\{/g)].map((m) => `${m[1]}.`);
    expect(prefixes.length).toBeGreaterThan(5);
    const all = Object.keys(STRINGS.en);
    expect(prefixes.filter((p) => !all.some((k) => k.startsWith(p)))).toEqual([]);
  });
});
