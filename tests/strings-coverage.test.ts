// Jeder in src/ verwendete String-Schlüssel existiert in beiden Sprachen (M2). Gelesen wird der Quelltext, nicht die
// Laufzeit: `t("…")`/`tn("…")` mit Literal, die Schlüssel-Tabellen `*_KEY`, und für Vorlagen-Schlüssel
// (`t(\`status.${…}\`)`) die geschlossenen Wertemengen aus den Typen.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings";
import { THINKING_LEVELS } from "../src/vendor/kit/sampling-profiles";

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

function retentionFields(): string[] {
  const m = /RETENTION_FIELDS[^=]*=\s*\[([^\]]*)\]/.exec(read("src/obsidian/settings-tab.ts"));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

describe("String-Abdeckung", () => {
  it("Probe der Wertemengen-Leser (leere Menge wäre ein stilles Grün)", () => {
    expect(retentionFields()).toEqual(["today", "days", "weeks", "months"]);
  });
  it("Inline-Tabellen und dynamisch zusammengesetzte Schlüssel existieren in beiden Sprachen", () => {
    const keys = [
      ...retentionFields().map((f) => `set.retention.${f}`),
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
    expect(keys.has("chat.modelLabel")).toBe(true);
    // Untergrenze gegen einen leeren Parser. 70 Schlüssel seit dem Umstieg auf das Kit-Chatfenster (vorher 80): zehn Chat-Texte (Senden, Stopp, Neuer Chat,
    // Rollenköpfe, Arbeitsanzeige, Denkblock, Abbruch, Fehler, kein Endpunkt) kommen jetzt aus dem Kit-Bündel; `chat.modelLabel` ist neu.
    expect(keys.size).toBeGreaterThan(65);
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
