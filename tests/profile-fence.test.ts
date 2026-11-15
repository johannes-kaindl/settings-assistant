import { describe, expect, it } from "vitest";
import { extractProfileBlocks } from "../src/core/chat-context";
import { findProfileFences, stripProfileBlocks } from "../src/core/profile-fence";
import { listFences } from "../src/vendor/kit/fences";

const B = "`".repeat(3);
const T = "~".repeat(3);
const body = '{"version":1,"plugins":{"koda-agent":{"maxRounds":20}}}';

/** Varianten eines settings-profile-Zauns, die CommonMark/Obsidian als diesen Block erkennen (I3). */
const VARIANTS: Array<[string, string, string]> = [
  ["direkt", `${B}settings-profile`, B],
  ["Leerzeichen vor dem Tag", `${B} settings-profile`, B],
  ["Tab vor dem Tag", `${B}\tsettings-profile`, B],
  ["Einzug 3 Leerzeichen", `   ${B}settings-profile`, `   ${B}`],
  ["Großschreibung", `${B}Settings-Profile`, B],
  ["Tilde", `${T}settings-profile`, T],
  ["Tilde mit Leerzeichen", `${T} settings-profile`, T],
  ["vier Backticks, Info-String dahinter", `${B}\` settings-profile {x}`, `${B}\``],
];

describe("settings-profile-Zäune (eine Quelle für strip und extract)", () => {
  it.each(VARIANTS)("%s: extract findet den Block", (_n, open, close) => {
    const blocks = extractProfileBlocks(`Sure.\n${open}\n${body}\n${close}\nDone.`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.result.ok).toBe(true);
  });
  it.each(VARIANTS)("%s: strip entfernt den Block und lässt den Rest", (_n, open, close) => {
    const out = stripProfileBlocks(`Sure.\n${open}\n${body}\n${close}\nDone.`);
    expect(out.toLowerCase()).not.toContain("settings-profile");
    expect(out).not.toContain("maxRounds");
    expect(out).toContain("Sure.");
    expect(out).toContain("Done.");
  });
  it("ein kürzerer Zaun schließt einen längeren nicht", () => {
    const four = `${B}\``;
    const text = `${four}settings-profile\n${body}\n${B}\n${four}\nDone.`;
    expect(extractProfileBlocks(text)).toHaveLength(1);
    expect(stripProfileBlocks(text)).toBe("Done.");
  });
  it("ein anderer Tag mit gleichem Präfix ist kein Profilblock", () => {
    expect(extractProfileBlocks(`${B}settings-profilex\n${body}\n${B}`)).toEqual([]);
    expect(stripProfileBlocks(`${B}settings-profilex\n${body}\n${B}`)).toContain("settings-profilex");
  });
});

describe("extractProfileBlocks: unvollständiger Zaun", () => {
  it("ein Zaun ohne Schluss ist kein Block (abgebrochener Stream)", () => {
    expect(extractProfileBlocks(`Sure.\n${B}settings-profile\n${body}`)).toEqual([]);
  });
  it("nur der geschlossene von zwei Zäunen wird gezogen", () => {
    const out = extractProfileBlocks(`${B}settings-profile\n${body}\n${B}\ntext\n${B}settings-profile\n{"version":1`);
    expect(out).toHaveLength(1);
    expect(out[0]!.raw).toBe(body);
  });
});

describe("stripProfileBlocks", () => {
  const body = '{"version":1}';
  it("entfernt vollständige Zäune", () => {
    expect(stripProfileBlocks(`a\n\`\`\`settings-profile\n${body}\n\`\`\`\nb`)).not.toContain("settings-profile");
  });
  it("entfernt einen unvollständigen Zaun bis Textende", () => {
    const out = stripProfileBlocks(`a\n\`\`\`settings-profile\n${body}\nmore`);
    expect(out).not.toContain("settings-profile");
    expect(out).not.toContain("more");
    expect(out).toContain("a");
  });
  it("entfernt ~~~-Zäune", () => {
    const out = stripProfileBlocks(`a\n~~~settings-profile\n${body}\n~~~\nb`);
    expect(out).not.toContain("settings-profile");
    expect(out).toContain("b");
  });
  it("lässt andere Zäune stehen", () => {
    expect(stripProfileBlocks("```json\n{}\n```")).toContain("```json");
  });
});

// Umstellung auf `listFences` (code-kit `fences`): die frühere Eigenfassung steht hier als Referenz für den Differentialtest und für die zwei gewollten Abweichungen.
const OPEN_REF = /^[ \t]*(`{3,}|~{3,})[ \t]*settings-profile(?=[ \t]|$)/i;
function referenz(text: string): Array<{ start: number; end: number; body: string; closed: boolean }> {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const out: Array<{ start: number; end: number; body: string; closed: boolean }> = [];
  const isCloser = (line: string, ch: string, len: number): boolean => { const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line); return m !== null && m[1]![0] === ch && m[1]!.length >= len; };
  let i = 0;
  while (i < lines.length) {
    const m = OPEN_REF.exec(lines[i]!);
    if (m === null) { i++; continue; }
    const ch = m[1]![0]!; const len = m[1]!.length;
    let j = i + 1;
    while (j < lines.length && !isCloser(lines[j]!, ch, len)) j++;
    const closed = j < lines.length;
    out.push({ start: i, end: closed ? j + 1 : lines.length, body: lines.slice(i + 1, j).join("\n"), closed });
    i = closed ? j + 1 : lines.length;
  }
  return out;
}

describe("findProfileFences gegen die frühere Eigenfassung (Differentialtest)", () => {
  // Zeilen, aus denen Texte entstehen; alle Zäune darin sind settings-profile (sonst gelten die gewollten Abweichungen).
  const ZEILEN = [`${B}settings-profile`, `  ${T}settings-profile`, `${B}`, `${T}`, `${B}\``, `\t${B}`, `${B}SETTINGS-PROFILE {x}`, "text", '{"a":1}', "", `${B}  `];
  function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
  it("2000 erzeugte Texte, soweit alle Zäune settings-profile sind: gleiche Zäune (start, end, body, closed)", () => {
    const rnd = lcg(35);
    let verglichen = 0; let mitZaun = 0;
    for (let n = 0; n < 2000; n++) {
      const len = 1 + Math.floor(rnd() * 9);
      const text = Array.from({ length: len }, () => ZEILEN[Math.floor(rnd() * ZEILEN.length)]!).join(rnd() < 0.3 ? "\r\n" : "\n");
      // Prämisse der Gleichheit: jeder Zaun des Textes ist ein settings-profile-Zaun; ein anderer Zaun davor ist die gewollte Abweichung (2).
      if (!listFences(text, { maxIndent: Infinity }).every((f) => f.lang === "settings-profile")) continue;
      const neu = findProfileFences(text);
      const alt = referenz(text);
      expect(neu, JSON.stringify(text)).toEqual(alt);
      verglichen++; if (alt.length > 0) mitZaun++;
    }
    // Positivkontrolle: die Texte enthalten wirklich Zäune, sonst verglichen zwei leere Listen.
    expect(verglichen).toBeGreaterThan(300);
    expect(mitZaun).toBeGreaterThan(150);
  });
});

describe("findProfileFences: gewollte Abweichungen vom Kit (CommonMark-genau)", () => {
  it("(1) Info-String mit Backtick nach dem Tag ist kein Zaun (früher einer)", () => {
    const text = `${B}settings-profile x\`y\n${body}\n${B}`;
    expect(referenz(text)).toHaveLength(1);
    expect(findProfileFences(text)).toEqual([]);
    expect(stripProfileBlocks(text)).toContain("maxRounds");
  });
  it("(2) ein anderer Zaun davor verschluckt einen späteren settings-profile-Öffner (früher gefunden)", () => {
    const text = `${B}json\n${B}settings-profile\n${body}\n${B}\nDone.`;
    expect(referenz(text)).toHaveLength(1);
    // Das Kit liest `json` bis zum ersten Schließer (die Zeile 4): der settings-profile-Öffner ist Inhalt des json-Zauns.
    expect(findProfileFences(text)).toEqual([]);
  });
  it("(3) Tilde-Zaun mit Backtick im Info-String bleibt ein Zaun, wenn das Tag das erste Wort ist (früher keiner)", () => {
    const text = `${T}settings-profile\`x\n${body}\n${T}`;
    expect(referenz(text)).toEqual([]);
    expect(findProfileFences(text)).toHaveLength(1);
  });
  it("(4) ein einzelnes \\r am Textende (ohne \\n) bleibt im Inhalt eines offenen Zauns (früher entfernt); die Verbraucher kürzen den Inhalt ohnehin (`trim`)", () => {
    const text = `${B}settings-profile\n${body}\n\r`;
    expect(referenz(text)[0]!.body).toBe(`${body}\n`);
    expect(findProfileFences(text)[0]!.body).toBe(`${body}\n\r`);
    expect(findProfileFences(text)[0]!.body.trim()).toBe(body);
  });
});
