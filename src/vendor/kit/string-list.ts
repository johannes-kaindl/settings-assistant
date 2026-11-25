// vendored from code-kit@0.91.1, src/ts/pure/string-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Reading a list of strings out of a value nobody typed: JSON from disk, a settings object, a parsed frontmatter, a model's answer. Three contracts that
 *  stood in the plugins as private one-liners under three names, kept apart on purpose (they answer different questions):
 *
 *  - {@link isStringList} — **is it one?** A type guard, strict: an array whose every element is a string. Nothing is converted, nothing dropped.
 *  - {@link asStringArray} — **give me the strings in it.** Lenient: anything that is no array is `[]`, the elements that are no strings are dropped, the
 *    empty string stays. A new array every time.
 *  - {@link coerceStringList} — **read it as a frontmatter list.** A single value is a list of one (`author: Ada` and `author: [Ada]` mean the same),
 *    numbers, booleans and dates become text, empty strings and everything else (objects, nested lists, `null`) drop out.
 *
 *  Origin (Welle 37, kit-a): `isStringList` of settings-assistant `core/chat-ask.ts`, `stringList` of finance-ledger `core/config/vertraege.ts` and
 *  `konten.ts` (two identical copies; the same filter stood inline in anysource-sideloader, docs-mirror, filename-sanitizer, koda-agent, mailstone and
 *  shadow-tree), `asStringArray` and `scalarToString` of epub-exporter `core/frontmatter.ts`. **The last one is not the lenient filter:** it wraps a
 *  single value and drops empty strings, finance-ledger's `stringList("x")` is `[]` and its `stringList(["", "a"])` keeps the empty string. A carrier that
 *  swaps its private `asStringArray` for the kit's function of the same name would silently change what it reads: epub-exporter takes
 *  {@link coerceStringList}, finance-ledger takes {@link asStringArray}.
 *
 *  One difference from the copies, on purpose: {@link isStringList} reads an array with a hole (`[ , "a"]`) as no list. `Array.prototype.every` skips the
 *  hole, so the settings-assistant guard said "string[]" about an array whose first element is `undefined`. JSON and YAML never produce a hole; a caller
 *  that builds arrays by index can. Pure, no I/O, linear in the length of the list. */

/** `v` is an array whose every element is a string (an empty array is one). A hole is no string. */
export function isStringList(v: unknown): v is string[] {
  if (!Array.isArray(v)) return false;
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== "string") return false;
  return true;
}

/** The strings of `v`: `[]` for anything that is no array, the elements that are no strings dropped, empty strings and duplicates kept, order kept. A new array. */
export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** A scalar frontmatter value as text. Deliberately narrow: only what has a meaningful `toString()`: a string as it is, a number or boolean by `String`, a
 *  `Date` by `String` (YAML parsers, Obsidian's among them, turn an unquoted `date: 2024-01-15` into a real `Date`). `null`, `undefined`, objects, lists, functions
 *  and symbols are `undefined`: a plain object falling through to `Object.prototype.toString` would write the text `[object Object]` into a book's metadata. */
export function scalarToString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return String(v);
  return undefined;
}

/** A frontmatter value as a list of non-empty strings: `undefined` and `null` are `[]`, a scalar is a list of one ({@link scalarToString}), a list is
 *  read element by element and what is no non-empty scalar drops out. A list inside a list is not flattened. */
export function coerceStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(scalarToString).filter((s): s is string => s !== undefined && s.length > 0);
  const s = scalarToString(v);
  return s !== undefined && s.length > 0 ? [s] : [];
}
