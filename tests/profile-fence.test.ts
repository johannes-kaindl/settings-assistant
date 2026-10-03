import { describe, expect, it } from "vitest";
import { extractProfileBlocks } from "../src/core/chat-context";
import { stripProfileBlocks } from "../src/core/profile-fence";

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
