import { beforeEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/strings";
import { makeFakeEl, Notice } from "./vendor/kit/obsidian-mock";
import type { CheckRow } from "../src/core/reconcile";
import { parseProfile } from "../src/core/profile";
import { renderProfileBlock, renderProfileResult } from "../src/obsidian/profile-block";

const mk = (over: Partial<CheckRow>): CheckRow => ({ target: { kind: "plugin", id: "p" }, path: ["a"], status: "change", current: 1, desired: 2, checked: true, selectable: true, ...over });
const good = JSON.stringify({ version: 1, plugins: { p: { a: 2 } } });

function deps(rows: CheckRow[]) {
  const service = { plan: vi.fn(async () => rows), applyInteractive: vi.fn(async () => ({ cancelled: true as const })) };
  const open = vi.fn();
  return { service, open, d: { service, sourcePath: "n/Note.md", openPluginSettings: open } };
}

beforeEach(() => { Notice.instances.length = 0; });

describe("profile-block", () => {
  it("ungültiges JSON: Fehlerzeile, kein Knopf, kein Quelltext", async () => {
    const el = makeFakeEl();
    const { d, service } = deps([]);
    await renderProfileBlock(el, "{oops apiKey sk-LEAK", d);
    expect(el.textContent).toContain("not valid JSON");
    expect(el.textContent).not.toContain("sk-LEAK");
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(service.plan).not.toHaveBeenCalled();
  });

  it("future-version nennt die Version", async () => {
    const el = makeFakeEl();
    const { d } = deps([]);
    await renderProfileBlock(el, JSON.stringify({ version: 7 }), d);
    expect(el.textContent).toContain("made by a newer version (v7) — update Settings Assistant");
    expect(el.querySelectorAll("button")).toHaveLength(0);
  });

  it("gültig: nicht interaktive Zeilen, Knopf aktiv bei selectable", async () => {
    const el = makeFakeEl();
    const { d } = deps([mk({})]);
    await renderProfileBlock(el, good, d);
    expect(el.querySelectorAll(".sa-row")).toHaveLength(1);
    expect(el.querySelectorAll("input")).toHaveLength(0);
    const btn = el.querySelectorAll("button.sa-apply, .sa-apply")[0];
    expect(btn.textContent).toContain("Apply");
    expect(btn.disabled).toBeFalsy();
  });

  it("Knopf deaktiviert ohne selectable Zeile", async () => {
    const el = makeFakeEl();
    const { d } = deps([mk({ status: "same", selectable: false, checked: false })]);
    await renderProfileBlock(el, good, d);
    expect(el.querySelectorAll(".sa-apply")[0].disabled).toBe(true);
  });

  it("unbekannte Abschnitte: je eine Zeile", async () => {
    const el = makeFakeEl();
    const { d } = deps([mk({})]);
    await renderProfileBlock(el, JSON.stringify({ version: 1, plugins: { p: { a: 2 } }, zeta: {}, omega: {} }), d);
    expect(el.textContent).toContain("unknown section: zeta");
    expect(el.textContent).toContain("unknown section: omega");
  });

  it("Klick ruft applyInteractive mit note:-Origin und rendert neu", async () => {
    const el = makeFakeEl();
    const { d, service } = deps([mk({})]);
    await renderProfileBlock(el, good, d);
    el.querySelectorAll(".sa-apply")[0]._listeners["click"][0]();
    await vi.waitFor(() => expect(service.applyInteractive).toHaveBeenCalledTimes(1));
    const [, origin] = service.applyInteractive.mock.calls[0] as unknown as [unknown, string];
    expect(origin).toBe("note:n/Note.md");
    await vi.waitFor(() => expect(service.plan).toHaveBeenCalledTimes(2));
  });

  it("renderProfileResult nutzt den übergebenen origin und zeigt nie Geheimnisse", async () => {
    const el = makeFakeEl();
    const { service, open } = deps([mk({ status: "secret", selectable: false, checked: false, current: "LEAK", desired: "LEAK" })]);
    const r = parseProfile(good);
    await renderProfileResult(el, r, good, { service, origin: "chat", openPluginSettings: open });
    expect(el.textContent).not.toContain("LEAK");
    expect(el.querySelectorAll("button.sa-row-open, .sa-row-open")).toHaveLength(1);
    expect(el.querySelectorAll(".sa-apply")[0].disabled).toBe(true);
  });
});
