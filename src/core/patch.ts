import { isPlainObject, type Json } from "./types";

export class PatchError extends Error {}

/** Einrückung der Datei: "" = kompakt (einzeilig), sonst die erste Einrückung vor einem Schlüssel. */
function indentOf(text: string): string {
  if (!text.trimEnd().includes("\n")) return "";
  const m = /^([ \t]+)"/m.exec(text);
  return m ? m[1] : "  ";
}

// Bekannte Grenze (nicht reparieren): Schlüssel, die wie ganze Zahlen aussehen ("10"),
// sortiert JavaScript in Objekten nach vorn. Betrifft Obsidian-Einstellungen nach heutigem Bestand nicht.
export function applyRows(originalText: string | null, rows: ReadonlyArray<{ path: readonly string[]; desired: Json }>): string {
  const root: Json = originalText === null ? {} : (JSON.parse(originalText) as Json);
  if (!isPlainObject(root)) throw new PatchError("root-not-object");
  for (const row of rows) {
    if (row.path.length === 0) throw new PatchError("empty-path");
    let obj: { [k: string]: Json } = root;
    for (let i = 0; i < row.path.length - 1; i++) {
      const seg = row.path[i];
      const next = obj[seg];
      if (next === undefined) { const created: { [k: string]: Json } = {}; obj[seg] = created; obj = created; continue; }
      if (!isPlainObject(next)) throw new PatchError(`not-object:${row.path.slice(0, i + 1).join(".")}`);
      obj = next;
    }
    obj[row.path[row.path.length - 1]] = JSON.parse(JSON.stringify(row.desired)) as Json;
  }
  const indent = originalText === null ? "  " : indentOf(originalText);
  const trailing = originalText !== null && originalText.endsWith("\n") ? "\n" : "";
  return JSON.stringify(root, null, indent) + trailing;
}
