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
