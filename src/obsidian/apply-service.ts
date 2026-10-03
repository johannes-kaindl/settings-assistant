import { Notice, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { GfsPolicy } from "../vendor/kit/rotation";
import { runApply, runRestore, type ApplyPorts, type ApplyReport, type RestoreResult, type RowResult } from "../core/apply-run";
import { restoreDecision } from "../core/snapshot";
import { reconcile, type CheckRow } from "../core/reconcile";
import { redact } from "../core/secrets";
import { sameTarget, targetKey, type SettingsProfile, type Target } from "../core/types";
import { openApplyModal } from "./apply-modal";
import { readTargetStates } from "./config-io";
import { isPluginEnabled } from "./plugin-host";
import { openRestoreModal } from "./restore-modal";
import { loadRestoreItems, makePorts, pruneSnapshots } from "./snapshots";

export interface RestoreRow { path: string; decision: "restore" | "changed" | "unverified"; checked: boolean }
export interface RestoreReport { origin: string; snapshotDir: string | null; results: RestoreResult[] }

export interface ApplyDeps {
  ports?: ApplyPorts;
  confirm?: (rows: CheckRow[], willReload: string[]) => Promise<CheckRow[] | null>;
  /** Liefert die angehakten Pfade; `null` = Abbruch. */
  confirmRestore?: (rows: RestoreRow[]) => Promise<Set<string> | null>;
}

function outcomeText(r: RowResult): string {
  switch (r.outcome) {
    // Ein Plugin kann an den Pfad einen Teilbaum mit geheimem Namen zurückschreiben: nur geschwärzt zeigen.
    case "corrected": return t("outcome.corrected", r.actual === undefined ? "—" : JSON.stringify(redact(r.actual).value));
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

/** Text für Notice: nur Pfade und Ergebnis, nie Dateiinhalt. */
export function formatRestoreReport(report: RestoreReport): string {
  const lines = [t("restore.report.head", report.origin)];
  for (const r of report.results) {
    lines.push(`${r.path} — ${r.outcome === "error" ? t("restore.outcome.error", r.error ?? "") : t(`restore.outcome.${r.outcome}`)}`);
  }
  if (report.snapshotDir) lines.push(t("restore.report.safety", report.snapshotDir));
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

  async applyInteractive(profile: SettingsProfile, origin: string): Promise<ApplyReport | { cancelled: true } | { busy: true } | { error: string }> {
    // Wie bei Restore/Undo: jeder Aufrufer ist ein Klick; Schweigen sähe aus wie „nichts passiert“.
    if (this.running) { new Notice(t("restore.busy")); return { busy: true }; }
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
      if (report.snapshotDir !== null) await pruneSnapshots(this.app, Date.now(), this.settings().retention, [report.snapshotDir]).catch(() => []);
      new Notice(formatReport(report));
      return report;
    } catch (e) {
      // Nur Error.message — nie Dateiinhalt in die Meldung.
      const error = e instanceof Error ? e.message : String(e);
      new Notice(t("apply.failed", error));
      return { error };
    } finally {
      this.running = false;
    }
  }

  /** Spec § 7 „Zurückholen“: Dialog je Datei, dann derselbe Weg mit dem Schnappschuss als Quelle. */
  async restoreInteractive(dir: string): Promise<RestoreReport | { cancelled: true } | { busy: true } | { error: string }> {
    // Alle Aufrufer (Befehl, Einstellungs-Tab) sind Klicks des Nutzers: Schweigen sähe aus wie „nichts passiert“.
    if (this.running) { new Notice(t("restore.busy")); return { busy: true }; }
    this.running = true;
    try {
      const ports = this.deps.ports ?? makePorts(this.app);
      const items = await loadRestoreItems(this.app, dir);
      if (items.length === 0) { new Notice(t("restore.none")); return { cancelled: true }; }
      const decisions = new Map<string, RestoreRow["decision"]>();
      for (const it of items) decisions.set(it.file.path, restoreDecision(it.file, await ports.read(it.file.path)));
      const rows: RestoreRow[] = items.map((it) => {
        const decision = decisions.get(it.file.path) ?? "changed";
        return { path: it.file.path, decision, checked: decision === "restore" };
      });
      const confirm = this.deps.confirmRestore ?? ((rs) => openRestoreModal(this.app, rs));
      const chosen = await confirm(rows);
      if (chosen === null || !rows.some((r) => chosen.has(r.path))) return { cancelled: true };
      // Abgewählte unveränderte Dateien fallen ganz heraus; abgewählte geänderte bleiben im Eingang und erscheinen im Bericht als „bleibt“.
      const todo = items.filter((it) => decisions.get(it.file.path) !== "restore" || chosen.has(it.file.path));
      const force = new Set([...chosen].filter((p) => decisions.get(p) !== "restore"));
      const origin = `restore:${dir}`;
      const run = await runRestore(todo, force, ports, { origin });
      const report: RestoreReport = { origin, ...run };
      if (run.snapshotDir !== null) await pruneSnapshots(this.app, Date.now(), this.settings().retention, [run.snapshotDir]).catch(() => []);
      new Notice(formatRestoreReport(report));
      return report;
    } catch (e) {
      // Nur Error.message — nie Dateiinhalt in die Meldung.
      const error = e instanceof Error ? e.message : String(e);
      new Notice(t("restore.failed", error));
      return { error };
    } finally {
      this.running = false;
    }
  }
}
