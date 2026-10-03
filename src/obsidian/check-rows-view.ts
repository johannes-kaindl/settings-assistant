import { t } from "../vendor/kit/i18n";
import type { CheckRow, RowStatus } from "../core/reconcile";
import type { Json } from "../core/types";

/** Symbol nur als Zusatz neben dem Text (aria-hidden), nie allein. */
const SYMBOL: Record<RowStatus, string> = {
  change: "→", same: "✓", "missing-key": "+", "not-installed": "⚠",
  unreadable: "⚠", "shape-conflict": "⚠", secret: "🔒", "read-only": "👁",
};

export interface CheckRowsOptions {
  interactive: boolean;
  onToggle?: (i: number, checked: boolean) => void;
  openPluginSettings?: (id: string) => void;
}

function compact(v: Json): string {
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/** Eine Zeile je CheckRow. Werte erscheinen nur, wo die Zeile sie trägt (secret-Zeilen tragen keine). */
export function renderCheckRows(parent: HTMLElement, rows: CheckRow[], opts: CheckRowsOptions): void {
  if (rows.length === 0) {
    parent.createDiv({ cls: "sa-empty", text: t("rows.empty") });
    return;
  }
  const list = parent.createDiv({ cls: "sa-rows" });
  rows.forEach((row, i) => {
    const el = list.createDiv({ cls: `sa-row is-${row.status}` });
    const head = el.createDiv({ cls: "sa-row-head" });
    const path = row.path.join(".");
    if (opts.interactive && row.selectable) {
      const cb = head.createEl("input", { attr: { type: "checkbox", "aria-label": t("rows.select", path) } });
      cb.checked = row.checked;
      cb.addEventListener("change", () => { opts.onToggle?.(i, cb.checked); });
    }
    head.createSpan({ cls: "sa-row-icon", text: SYMBOL[row.status], attr: { "aria-hidden": "true" } });
    head.createSpan({ cls: "sa-row-path", text: path });
    el.createDiv({ cls: "sa-row-status", text: t(`status.${row.status}`) });
    if (row.status !== "secret" && (row.current !== undefined || row.desired !== undefined)) {
      const cur = row.current !== undefined ? compact(row.current) : "—";
      const des = row.desired !== undefined ? compact(row.desired) : "—";
      el.createDiv({ cls: "sa-row-values", text: `${cur} → ${des}` });
    }
    if (row.note) el.createDiv({ cls: "sa-row-note", text: t("rows.note", row.note) });
    if (row.status === "secret" && row.target.kind === "plugin" && opts.openPluginSettings) {
      const id = row.target.id;
      const btn = el.createEl("button", { cls: "sa-row-open", text: t("rows.openSettings") });
      btn.addEventListener("click", () => { opts.openPluginSettings?.(id); });
    }
  });
}
