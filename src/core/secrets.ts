import { getAt, isPlainObject, type Json } from "./types";

const NAME_PATTERNS = ["apikey", "api_key", "token", "secret", "password", "credential", "cookie", "email"];
const AUTH = /auth(?!or)/;
export const REDACTED = "🔒";

/** Spec § 11: Teilstring im kleingeschriebenen Namen. Allein nie ausreichend — siehe isSecretValue. */
export function isSecretName(name: string): boolean {
  const l = name.toLowerCase();
  return AUTH.test(l) || NAME_PATTERNS.some((p) => l.includes(p));
}

/** Name passt UND Wert ist nicht-leerer Text oder Objekt/Liste (ganzer Teilbaum). */
export function isSecretValue(name: string, value: Json | undefined): boolean {
  if (value === undefined || value === null || !isSecretName(name)) return false;
  if (typeof value === "string") return value.length > 0;
  return typeof value === "object";
}

/** Ein Pfad ist geheim, wenn irgendein Abschnitt auf dem Weg ein geheimer Wert ist. */
export function isSecretPath(root: Json | null, path: readonly string[]): boolean {
  for (let i = 0; i < path.length; i++) {
    if (isSecretValue(path[i], getAt(root, path.slice(0, i + 1)))) return true;
  }
  return false;
}

export function redact(value: Json): { value: Json; redacted: string[] } {
  const redacted: string[] = [];
  const walk = (v: Json, path: string[]): Json => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]));
    if (!isPlainObject(v)) return v;
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) {
      if (isSecretValue(k, x)) { out[k] = REDACTED; redacted.push([...path, k].join(".")); }
      else out[k] = walk(x, [...path, k]);
    }
    return out;
  };
  return { value: walk(value, []), redacted };
}
