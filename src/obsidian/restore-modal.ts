import { ButtonComponent, Modal, Setting, type App } from "obsidian";
import { t } from "../vendor/kit/i18n";
import type { RestoreRow } from "./apply-service";

/** Dialog „Schnappschuss zurückholen“: eine Zeile je Datei. Unveränderte Dateien sind angehakt, geänderte
 *  und ungeprüfte nicht — Anhaken heißt bewusst überschreiben (force). Der Zustand steht als Text, nicht nur als Farbe. */
class RestoreModal extends Modal {
  private done: ((chosen: Set<string> | null) => void) | null;
  private applyBtn: ButtonComponent | null = null;
  private readonly rows: RestoreRow[];

  constructor(app: App, rows: RestoreRow[], done: (chosen: Set<string> | null) => void) {
    super(app);
    this.rows = rows.map((r) => ({ ...r }));
    this.done = done;
  }

  private count(): number { return this.rows.filter((r) => r.checked).length; }

  private refresh(): void {
    const n = this.count();
    this.applyBtn?.setButtonText(t("restore.apply", n)).setDisabled(n === 0);
  }

  onOpen(): void {
    this.titleEl.setText(t("restore.title"));
    for (const r of this.rows) {
      const s = new Setting(this.contentEl).setName(r.path).setDesc(t(`restore.state.${r.decision}`));
      s.addToggle((tg) => {
        tg.setValue(r.checked).onChange((v) => { r.checked = v; this.refresh(); });
        tg.toggleEl.setAttribute("aria-label", t("restore.select", r.path));
      });
    }
    // Kanon (UI-STANDARD §8 Confirm-Modal): Abbrechen links, Bestätigen rechts, nativer Container.
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("modal.cancel")).onClick(() => { this.finish(null); });
    this.applyBtn = new ButtonComponent(btns).setCta().onClick(() => { this.finish(new Set(this.rows.filter((r) => r.checked).map((r) => r.path))); });
    this.refresh();
  }

  onClose(): void {
    this.finish(null);
    this.contentEl.empty();
  }

  /** Callback VOR dem Auflösen nullen (Klick + nachlaufendes onClose), onClose = Abbrechen. */
  private finish(result: Set<string> | null): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(result);
    this.close();
  }
}

export function openRestoreModal(app: App, rows: RestoreRow[]): Promise<Set<string> | null> {
  return new Promise((resolve) => { new RestoreModal(app, rows, resolve).open(); });
}
