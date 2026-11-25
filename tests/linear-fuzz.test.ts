/**
 * Linearität der Funktionen, die Modell- oder Fremdtext zerlegen (ReDoS-Konvention, CORE-TEST-26 (b)): der erschöpfende Fuzz `pruefeLinearFuzz`
 * aus dem Kit-Testmodul, dazu feste Eingaben für die Stellen, die er nicht erreicht. Gemessen wird ein Quotient t(50 000)/t(10 000), keine Millisekunden.
 *
 * Geprüft sind die Wege, auf denen eine Modellantwort oder eine fremde `data.json` ankommt: Zaun-Erkennung und Entfernen (`findProfileFences`,
 * `stripProfileBlocks`), Blockauszug samt Profil-Parser (`extractProfileBlocks`), Schwärzen (`redactedRawBlock`, `redactedProfileNote`), Plugin-Vorschlag
 * aus der Nutzernachricht (`suggestPlugins`) und das Schreiben in eine `data.json` (`applyRows`).
 *
 * Nicht Gegenstand: `neutralizeModelMarkdown` und `listFences` (Kit, dort mit eigenem Fuzz) und `JSON.parse` (V8, linear).
 * Die Gegenprobe (eine absichtlich quadratische Fassung wird rot) steht am Ende dieser Datei.
 */
import { describe, expect, it } from "vitest";
import { lastGeschuetzt } from "./vendor/kit/linear-probe";
import { findProfileFences, stripProfileBlocks } from "../src/core/profile-fence";
import { extractProfileBlocks, suggestPlugins } from "../src/core/chat-context";
import { parseProfile } from "../src/core/profile";
import { redactedProfileNote, redactedRawBlock } from "../src/core/profile-note";
import { applyRows } from "../src/core/patch";

const FUZZ_MS = 180_000;
const PROFIL_VORSPANN = '{"version":1,"plugins":{"p":{"k":';

/** Das Muster aus `pruefeLinearFuzz`: Befund als lesbarer Text, damit eine rote Zeile ohne Nachlesen verständlich ist (CORE-TEST-14). */
const befund = (r: { verdaechtig: ReadonlyArray<{ message: string }> }): string => r.verdaechtig.map((v) => v.message).join("\n");

describe("Zaun-Erkennung (Modellantwort)", () => {
  it("findProfileFences und stripProfileBlocks: Fuzz über Zaunzeichen, Zeilenumbruch, Einzug und das Sprachwort", (ctx) => {
    // Ganze Zaunzeilen als Einträge: ein Öffner mit Sprachwort wäre aus Einzelzeichen erst bei fünf Einträgen gebaut (maxLaenge 3), und ohne gefundenen Zaun
    // endet `stripProfileBlocks` vor dem teuren Teil. Die Mutationsprobe (quadratische Schleife hinter dem Frühausstieg) belegt, dass dieses Alphabet ihn erreicht.
    const alphabet = ["```settings-profile\n", "```\n", "~~~settings-profile\n", "~~~\n", "`", "\n", " "];
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => findProfileFences(s), { alphabet, maxLaenge: 3 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
    const g = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => stripProfileBlocks(s), { alphabet, maxLaenge: 3 });
    expect(g.linear, befund(g)).toBe(true);
    expect(g.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("viele kurze Blöcke nacheinander: stripProfileBlocks bleibt linear (Set und Filter über die Zeilen)", (ctx) => {
    const block = "```settings-profile\n{}\n```\ntext\n";
    const r = lastGeschuetzt(ctx).pruefeLinear(stripProfileBlocks, (n) => block.repeat(Math.ceil(n / 8)));
    expect(r.linear, r.message).toBe(true);
    const offen = lastGeschuetzt(ctx).pruefeLinear(stripProfileBlocks, (n) => "```settings-profile\n".repeat(Math.ceil(n / 10)));
    expect(offen.linear, offen.message).toBe(true);
  });
});

describe("Blockauszug und Profil-Parser (Modellantwort)", () => {
  it("extractProfileBlocks: Fuzz über Zäune und JSON-Zeichen", (ctx) => {
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => extractProfileBlocks(s), {
      alphabet: ["```settings-profile\n", "```\n", "{", "}", '"', "\n"],
      maxLaenge: 3,
    });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("parseProfile und redactedRawBlock hinter einem gültigen Profil-Vorspann: Fuzz über JSON-Zeichen", (ctx) => {
    // Der Vorspann lässt jede Eingabe bis zum Parser des Werts laufen; ein Frühausstieg bei `version` misst sonst nichts (Schritt 1 der Konvention).
    const lauf = (s: string): void => {
      const text = `${PROFIL_VORSPANN}${s}}}}`;
      const r = parseProfile(text);
      redactedRawBlock(text, r);
    };
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz(lauf, { alphabet: ["{", "}", "[", "]", '"', ",", ":", "1"], maxLaenge: 2 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("breite Werte: viele Schlüssel, lange Schlüsselnamen, lange Zeichenketten bleiben linear", (ctx) => {
    const schluessel = (n: number): string => `{${Array.from({ length: Math.ceil(n / 6) }, (_v, i) => `"k${i}":1`).join(",")}}`;
    const breit = lastGeschuetzt(ctx).pruefeLinear((s: string) => redactedRawBlock(s, parseProfile(s)), (n) => `${PROFIL_VORSPANN}${schluessel(n)}}}}`);
    expect(breit.linear, breit.message).toBe(true);
    const liste = lastGeschuetzt(ctx).pruefeLinear((s: string) => redactedRawBlock(s, parseProfile(s)), (n) => `${PROFIL_VORSPANN}[${"1,".repeat(n)}1]}}}`);
    expect(liste.linear, liste.message).toBe(true);
    // Der Name wird gegen die Geheimnis-Muster geprüft (`AUTH`, Teilstrings): lange Namen mit fast-treffenden Anfängen.
    for (const einheit of ["a", "auth", "authori", "api_", "to"]) {
      const name = lastGeschuetzt(ctx).pruefeLinear((s: string) => redactedRawBlock(s, parseProfile(s)), (n) => `${PROFIL_VORSPANN}{"${einheit.repeat(n)}":"v"}}}}`);
      expect(name.linear, `${einheit}: ${name.message}`).toBe(true);
    }
  });

  it("redactedProfileNote: sehr viele Backtick-Läufe im Inhalt werfen nicht (der Zaun wird länger als jede Folge)", () => {
    // 200 000 Läufe: `Math.max(0, ...läufe)` ließe den Aufruf mit RangeError scheitern (Argumentgrenze), gemessen vor dem Fix bei rund 150 000.
    const body = "`a".repeat(200_000);
    const note = redactedProfileNote({ version: 1, entries: [], notes: { x: body }, unknownSections: [] });
    expect(note.text.startsWith("```settings-profile\n")).toBe(true);
    const lang = redactedProfileNote({ version: 1, entries: [], notes: { x: "`".repeat(5000) }, unknownSections: [] });
    expect(lang.text.startsWith("`".repeat(5001))).toBe(true);
  });

  it("redactedProfileNote: Backtick-Läufe bleiben linear", (ctx) => {
    const r = lastGeschuetzt(ctx).pruefeLinear(
      (n: number) => redactedProfileNote({ version: 1, entries: [], notes: { x: "`a".repeat(n) }, unknownSections: [] }),
      (n) => n,
    );
    expect(r.linear, r.message).toBe(true);
  });
});

describe("Nutzernachricht und fremde data.json", () => {
  it("suggestPlugins: lange Nachricht gegen eine Plugin-Liste", (ctx) => {
    const installed = [{ id: "vault-rag", name: "Vault RAG" }, { id: "settings-assistant", name: "Settings Assistant" }, { id: "x", name: "ab" }];
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => suggestPlugins(s, installed), { alphabet: ["v", "a", "-", " ", "vault-rag"], maxLaenge: 3 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);

  it("applyRows: Einrückungs-Suche und Schreiben in eine große data.json bleiben linear", (ctx) => {
    const rows = [{ path: ["a"], desired: 1 }];
    const nurLeerraum = lastGeschuetzt(ctx).pruefeLinear((s: string) => applyRows(s, rows), (n) => `{\n${" ".repeat(n)}}`);
    expect(nurLeerraum.linear, nurLeerraum.message).toBe(true);
    const viele = lastGeschuetzt(ctx).pruefeLinear((s: string) => applyRows(s, rows), (n) => `{${"\n ".repeat(n)}}`);
    expect(viele.linear, viele.message).toBe(true);
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz((s) => applyRows(`{\n${s}}`, rows), { alphabet: [" ", "\t", "\n", '"', ":", ","], maxLaenge: 3 });
    expect(f.linear, befund(f)).toBe(true);
    expect(f.gemessen, "der Fuzz hat Eingaben gemessen").toBeGreaterThan(20);
  }, FUZZ_MS);
});

describe("Gegenprobe: der Fuzz kann rot werden (CORE-TEST-01)", () => {
  /** Absichtlich quadratisch: ein Zeilen-Scan, der für jede Zeile den Rest des Texts neu zerlegt. */
  const quadratisch = (text: string): number => {
    let c = 0;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") c += text.slice(i).split("\n").length;
    return c;
  };

  it("pruefeLinearFuzz meldet die quadratische Fassung als Verdacht", (ctx) => {
    const f = lastGeschuetzt(ctx).pruefeLinearFuzz(quadratisch, { alphabet: ["\n", "x"], maxLaenge: 1, verschachtelt: false });
    expect(f.linear).toBe(false);
    expect(f.verdaechtig.map((v) => v.einheit)).toContain("\n");
  }, FUZZ_MS);
});
