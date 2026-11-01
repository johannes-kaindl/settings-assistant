import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("styles.css", "utf8");
/** Der Rumpf der ersten Regel, deren Selektor genau `sel` ist (ohne Kommentare, einzeilig oder mehrzeilig). */
function rule(sel: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = stripped.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`Regel „${sel}“ fehlt in styles.css`);
  return m[1]!;
}

// WCAG 2.2: Kontrast 1.4.3 (4,5:1 für kleinen Text), Zielgröße 2.5.8 (24 × 24 CSS-px). `--text-faint` liegt hell wie dunkel unter 4,5:1 (gemessen 2026-10-26: 2,12 und 2,57).
describe("Beschriftungen, die das Plugin unter eine Antwort setzt", () => {
  for (const sel of [".sa-chat-raw > summary", ".sa-chat-sent > summary", ".sa-chat-sent-label"]) {
    it(`${sel} nimmt --text-muted statt --text-faint`, () => {
      const body = rule(sel);
      expect(body).toContain("color: var(--text-muted)");
      expect(body).not.toContain("--text-faint");
    });
  }

  for (const sel of [".sa-chat-raw > summary", ".sa-chat-sent > summary"]) {
    it(`${sel} hat eine Tippfläche von mindestens 24 px`, () => {
      expect(rule(sel)).toContain("min-height: var(--size-4-6)");
    });
    it(`${sel} hat mobil 44 px`, () => {
      expect(rule(`.is-mobile ${sel}`)).toContain("min-height: var(--input-height)");
    });
  }
});

describe("Chips der Plugin-Auswahl: eine Zeile (Daumen-Test, Welle 29)", () => {
  const css = readFileSync("styles.css", "utf8");
  const regel = (selektor: string): string => css.split("\n").find((l) => l.startsWith(`${selektor} {`)) ?? "";
  it("die Zeile bricht nicht um und rollt waagerecht; Chips kürzen ihren Namen, die Auswahl bleibt stehen", () => {
    expect(regel(".sa-chat-chips")).toContain("flex-wrap: nowrap");
    expect(regel(".sa-chat-chips")).toContain("overflow-x: auto");
    expect(regel(".sa-chip-label")).toContain("text-overflow: ellipsis");
    expect(regel(".sa-chip-add")).toContain("flex: 0 0 auto");
    // Abstand zur Modellzeile darüber (Abnahme 2026-11-01: das Dropdown berührte die Modellzeile) und gemeinsame Mittellinie. Seit Kit 0.74.0 sind Modellzeile und Einschub Geschwister im Composer:
    // den Abstand von 8 px liefert dessen `gap`, ein eigener Außenabstand der Chips machte 16 px (gemessen 390 × 844: 17,4 statt 17,8 Zeilen).
    expect(regel(".sa-chat-chips")).not.toContain("margin-top");
    expect(regel(".okit-chat-composer")).toContain("gap: var(--size-4-2)");
    expect(regel(".sa-chip")).toContain("align-self: center");
    expect(regel(".is-mobile .sa-chip")).toContain("min-height: var(--input-height)");
  });

  it("im Hauptbereich des Handys lässt der Chat Platz für Obsidians Navigationsleiste, in einer Seitenleiste nicht", () => {
    const regelMobil = css.split("\n").find((l) => l.startsWith(".is-mobile .mod-root .sa-chat-host {")) ?? "";
    expect(regelMobil).toContain("padding-bottom: calc(var(--navbar-height) + var(--safe-area-inset-bottom))");
    expect(css.split("\n").filter((l) => /^\.is-mobile [^{]*\.sa-chat-host \{/.test(l))).toHaveLength(1);
  });
});
