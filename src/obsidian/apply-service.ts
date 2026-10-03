import { Notice, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { GfsPolicy } from "../vendor/kit/rotation";
import { runApply, type ApplyPorts, type ApplyReport, type RowResult } from "../core/apply-run";
import { reconcile, type CheckRow } from "../core/reconcile";
import { sameTarget, targetKey, type SettingsProfile, type Target } from "../core/types";
import { openApplyModal } from "./apply-modal";
import { readTargetStates } from "./config-io";
import { isPluginEnabled } from "./plugin-host";
import { makePorts, pruneSnapshots } from "./snapshots";

export interface ApplyDeps {
  ports?: ApplyPorts;
  confirm?: (rows: CheckRow[], willReload: string[]) => Promise<CheckRow[] | null>;
}

function outcomeText(r: RowResult): string {
  switch (r.outcome) {
    case "corrected": return t("outcome.corrected", r.actual === undefined ? "—" : JSON.stringify(r.actual));
    case "error": return t("outcome.error", r.error ?? "");
    default: return t(`outcome.${r.outcome}`);
  }
}

/** Text für Notice und API. Zeilen mit status "secret" tragen keine Werte und erscheinen nie mit welchen. */
export function formatReport(report: ApplyReport): string {
  const lines = [t("report.head", report.origin)];
  for (const r of report.results) {
    const where = `${targetKey(r.row.target)}.${r.row.path.join(".")}`;
    lines.push(r.row.status === "secret" ? `${where} — ${t("status.secret")}` : `${where} — ${outcomeText(r)}`);
  }
  if (report.stopped) lines.push(t("report.stopped"));
  if (report.snapshotDir) lines.push(t("report.snapshot", report.snapshotDir));
  return lines.join("\n");
}

export class ApplyService {
  private running = false;

  constructor(
    private readonly app: App,
    private readonly settings: () => { retention: GfsPolicy },
    private readonly deps: ApplyDeps = {},
  ) {}

  get busy(): boolean { return this.running; }

  async plan(profile: SettingsProfile): Promise<CheckRow[]> {
    const targets: Target[] = [];
    for (const e of profile.entries) if (!targets.some((x) => sameTarget(x, e.target))) targets.push(e.target);
    return reconcile(profile, await readTargetStates(this.app, targets));
  }

  async applyInteractive(profile: SettingsProfile, origin: string): Promise<ApplyReport | { cancelled: true } | { busy: true }> {
    if (this.running) return { busy: true };
    this.running = true;
    try {
      const rows = await this.plan(profile);
      const ids = new Set<string>();
      for (const r of rows) if (r.selectable && r.target.kind === "plugin" && isPluginEnabled(this.app, r.target.id)) ids.add(r.target.id);
      const confirm = this.deps.confirm ?? ((rs, reload) => openApplyModal(this.app, rs, reload));
      const selected = await confirm(rows, [...ids]);
      if (selected === null) return { cancelled: true };
      const ports = this.deps.ports ?? makePorts(this.app);
      const report = await runApply(selected, ports, { configDir: this.app.vault.configDir, origin });
      // Aufräumen darf den Bericht nicht verdecken.
      if (report.snapshotDir !== null) await pruneSnapshots(this.app, Date.now(), this.settings().retention).catch(() => []);
      new Notice(formatReport(report));
      return report;
    } finally {
      this.running = false;
    }
  }
}
