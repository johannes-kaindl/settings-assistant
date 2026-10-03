// uebernommen aus obsidian-transmute/src/core/vault/snapshot.ts, 2026-10-03
// Angepasst: Herkunft statt Regel im Manifest, `existed` je Datei (eine data.json kann neu entstehen),
// Rotation über GFS (Kit `rotation`) statt fester Anzahl.

export interface SnapshotFile {
  path: string;
  /** false: die Datei gab es vor dem Lauf nicht — Zurückholen heißt dann löschen. */
  existed: boolean;
  /** Hash des GESCHRIEBENEN Inhalts; null, solange der Lauf läuft (Manifest zweiphasig). */
  afterHash: string | null;
}

export interface SnapshotManifest {
  version: 1;
  /** ISO-Zeitstempel der Anwendung. */
  at: string;
  /** Spec § 7: `note:<pfad>` · `chat:<zeit>/<modell>` · `api:<aufrufer>` · `restore:<dir>`. */
  origin: string;
  files: SnapshotFile[];
}

/** FNV-1a (32 bit), dem die Textlänge vorangestellt ist (unverändert aus transmute). */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(16)}-${h.toString(16).padStart(8, "0")}`;
}

/** Doppelpunkte sind auf Windows kein gültiger Pfadbestandteil. */
export function snapshotDirName(at: string): string {
  return at.replace(/\.\d+Z?$/, "").replace(/:/g, "-");
}

export function restoreDecision(file: SnapshotFile, currentText: string | null): "restore" | "changed" | "unverified" {
  if (currentText === null) return file.existed ? "changed" : "restore";
  if (file.afterHash === null) return "unverified";
  return hashText(currentText) === file.afterHash ? "restore" : "changed";
}
