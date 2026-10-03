import { ButtonComponent, Modal, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { CheckRow } from "../core/reconcile";
import { sameTarget, targetKey } from "../core/types";
import { renderCheckRows } from "./check-rows-view";

/** `app.setting` ist nicht in obsidian.d.ts; undokumentiert, deshalb mit Formcheck. */
export function openPluginSettings(app: App, id: string): void {
  const s = (app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => unknown } }).setting;
  if (!s || typeof s.open !== "function") return;
  s.open();
  s.openTabById?.(id);
}

class ApplyModal extends Modal {
  private done: ((rows: CheckRow[] | null) => void) | null;
  private applyBtn: ButtonComponent | null = null;
  private readonly rows: CheckRow[];

  constructor(app: App, rows: CheckRow[], private readonly willReload: string[], done: (rows: CheckRow[] | null) => void) {
    super(app);
    this.rows = rows.map((r) => ({ ...r }));
    this.done = done;
  }

  private count(): number {
    return this.rows.filter((r) => r.selectable && r.checked).length;
  }

  private refresh(): void {
    const n = this.count();
    this.applyBtn?.setButtonText(t("modal.apply", n)).setDisabled(n === 0);
  }

  onOpen(): void {
    this.titleEl.setText(t("modal.title"));
    const groups: Array<{ first: CheckRow; idx: number[] }> = [];
    this.rows.forEach((r, i) => {
      const g = groups.find((x) => sameTarget(x.first.target, r.target));
      if (g) g.idx.push(i); else groups.push({ first: r, idx: [i] });
    });
    for (const g of groups) {
      const box = this.contentEl.createDiv({ cls: "sa-group" });
      box.createEl("h4", { cls: "sa-group-title", text: targetKey(g.first.target) });
      if (g.first.target.kind === "plugin" && this.willReload.includes(g.first.target.id)) {
        box.createDiv({ cls: "sa-group-reload", text: t("modal.reload", g.first.target.id) });
      }
      renderCheckRows(box, g.idx.map((i) => this.rows[i]), {
        interactive: true,
        onToggle: (j, checked) => {
          const row = this.rows[g.idx[j]];
          if (row) row.checked = checked;
          this.refresh();
        },
        openPluginSettings: (id) => { openPluginSettings(this.app, id); },
      });
    }
    // Kanon (UI-STANDARD §8 Confirm-Modal): Abbrechen links, Bestätigen rechts, nativer Container.
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("modal.cancel")).onClick(() => { this.finish(null); });
    this.applyBtn = new ButtonComponent(btns).setCta().onClick(() => { this.finish(this.rows); });
    this.refresh();
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }

  /** Callback VOR dem Auflösen nullen (Klick + nachlaufendes onClose), onClose = Abbrechen. */
  private finish(result: CheckRow[] | null): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(result);
    this.close();
  }
}

export function openApplyModal(app: App, rows: CheckRow[], willReload: string[]): Promise<CheckRow[] | null> {
  return new Promise((resolve) => { new ApplyModal(app, rows, willReload, resolve).open(); });
}
