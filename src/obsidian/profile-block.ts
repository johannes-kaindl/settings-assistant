import { Notice } from "obsidian";
import { t } from "../vendor/kit/i18n";
import { tn } from "../i18n/plural";
import { parseProfile, type ParseResult, type ProfileError } from "../core/profile";
import type { SettingsProfile } from "../core/types";
import type { ApplyService } from "./apply-service";
import { renderCheckRows } from "./check-rows-view";

export interface ProfileResultDeps {
  service: Pick<ApplyService, "plan" | "applyInteractive">;
  /** Herkunft für Bericht und Schnappschuss, z. B. "note:<pfad>" oder "chat". */
  origin: string;
  openPluginSettings: (id: string) => void;
}

export interface ProfileBlockDeps {
  service: Pick<ApplyService, "plan" | "applyInteractive">;
  sourcePath: string;
  openPluginSettings: (id: string) => void;
}

function errorText(e: ProfileError): string {
  switch (e.code) {
    case "invalid-json": return t("profile.err.invalid-json");
    case "future-version": return t("profile.err.future-version", e.version);
    case "bad-version": return t("profile.err.bad-version");
    case "bad-section": return t("profile.err.bad-section", e.section);
    default: return t(`profile.err.${e.code}`);
  }
}

async function renderValid(el: HTMLElement, profile: SettingsProfile, deps: ProfileResultDeps): Promise<void> {
  // Ist-Werte bei jedem Rendern frisch lesen.
  const rows = await deps.service.plan(profile);
  el.empty();
  const box = el.createDiv({ cls: "sa-profile" });
  box.createEl("h4", { cls: "sa-profile-title", text: t("profile.title") });
  renderCheckRows(box, rows, { interactive: false, openPluginSettings: deps.openPluginSettings });
  for (const name of profile.unknownSections) {
    box.createDiv({ cls: "sa-profile-unknown", text: t("profile.unknown", name) });
  }
  const n = rows.filter((r) => r.selectable).length;
  const btn = box.createEl("button", { cls: "sa-apply mod-cta", text: tn("modal.apply", n) });
  btn.disabled = n === 0;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void (async () => {
      try {
        const r = await deps.service.applyInteractive(profile, deps.origin);
        if ("busy" in r) new Notice(t("service.busy"));
      } catch (e) {
        new Notice(t("apply.failed", e instanceof Error ? e.message : String(e)));
      } finally {
        await renderValid(el, profile, deps);
      }
    })();
  });
}

/** Rendert ein bereits geparstes Ergebnis (Chat und Codeblock). Zeigt nie den rohen Quelltext. */
export async function renderProfileResult(el: HTMLElement, result: ParseResult, _raw: string, deps: ProfileResultDeps): Promise<void> {
  if (!result.ok) {
    el.empty();
    el.createDiv({ cls: "sa-profile-error", text: errorText(result.error) });
    return;
  }
  await renderValid(el, result.profile, deps);
}

export function renderProfileBlock(el: HTMLElement, source: string, deps: ProfileBlockDeps): Promise<void> {
  return renderProfileResult(el, parseProfile(source), source, {
    service: deps.service,
    origin: `note:${deps.sourcePath}`,
    openPluginSettings: deps.openPluginSettings,
  });
}
