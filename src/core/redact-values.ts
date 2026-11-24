import { redactFields, redactText } from "../vendor/kit/redact";
import type { Json } from "./types";

/** `redactFields` (Wert unter einem geheimen NAMEN) plus die Geheimnis-Muster des Kits über jedes Text-Blatt: ein Schlüssel in einem Feld
 *  mit unverfänglichem Namen (Beschreibung, Notiz, Vorlage; `key_sk-proj-…`, `my_AKIA…`, `x_Bearer …`) geht sonst im Klartext an das Modell,
 *  in die Profilnotiz und über die Schnittstelle zu anderen Plugins. `redacted` nennt beide Arten von Treffern als Punktpfad.
 *  Nur Anzeige- und Ausgabewege: `reconcile` entscheidet den Zeilenstatus weiter nach dem Namen (ein Text mit Schlüsselform sperrt kein Feld). */
export function redactValues(value: Json): { value: Json; redacted: string[] } {
  const named = redactFields(value);
  const redacted = [...named.redacted];
  const walk = (v: Json, path: string[]): Json => {
    if (typeof v === "string") {
      const r = redactText(v);
      if (r.count > 0) redacted.push(path.join("."));
      return r.text;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, String(i)]));
    if (v === null || typeof v !== "object") return v;
    const out: { [k: string]: Json } = {};
    // defineProperty statt Zuweisung: ein geparster Schlüssel "__proto__" bleibt Datum und setzt keinen Prototyp.
    for (const [k, x] of Object.entries(v)) Object.defineProperty(out, k, { value: walk(x, [...path, k]), enumerable: true, writable: true, configurable: true });
    return out;
  };
  return { value: walk(named.value, []), redacted };
}
