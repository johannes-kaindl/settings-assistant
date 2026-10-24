// uebernommen aus src/obsidian/chat-view.ts (Welle 26: das Chat-Fenster ist jetzt der Kit-Baustein; dieser Schutz bleibt beim Plugin)
// Warum hier und nicht im Kit: `domGuard` (obsidian-kit) kappt aktive Elemente und Quellen, aber ausdruecklich keine Skript-Schemata in Links
// (code-kit `remote-resources.ts`: „No script defence“). Ein `javascript:`-, `data:`-, `file:`-, `obsidian://`- oder `app:`-Ziel kappt erst diese Datei.
// Befristet hier (Entscheidung des Masters, Welle 26): der Ort ist das Kit (`domGuard`-Option), Task „Linkschutz in Modellantworten — domGuard kappt gefährliche
// Link-Ziele, damit das Kit-Chatfenster keine Lücke hat“ im Dach-Cockpit (Welle 27). Bis zum Kit-Tag gilt: Funktion unverändert, kein Schärfen, kein Lockern.

const ACTIVE_TAGS = "img, iframe, embed, video, audio, object, link, style, svg, script, source";

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
/** Ziele, die auch ein interner Link (`data-href`) nie tragen darf. */
const NEVER_SCHEMES = new Set(["javascript", "data", "vbscript"]);

/** Schema eines Link-Ziels, wie der Browser es liest: Steuerzeichen und Leerraum fallen weg, Groß/Klein zählt nicht. `null` = kein Schema. */
function schemeOf(href: string): string | null {
  const clean = Array.from(href).filter((c) => { const n = c.charCodeAt(0); return n > 0x20 && !(n >= 0x7f && n <= 0x9f) && !(n >= 0x200b && n <= 0x200d) && n !== 0xfeff; }).join("");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  return m ? m[1].toLowerCase() : null;
}

/** Links: nur http(s), mailto und Ziele ohne Schema (interne Obsidian-Links, `#Abschnitt`) behalten das `href`; der Linktext bleibt. */
function sanitizeHref(a: Element): void {
  const href = a.getAttribute("href");
  if (href === null) return;
  const scheme = schemeOf(href);
  if (scheme === null || SAFE_SCHEMES.has(scheme)) return;
  // Ein interner Link darf ein Wiki-Ziel mit Doppelpunkt tragen („Titel: Untertitel“), aber kein ausführbares Schema.
  if (a.getAttribute("data-href") !== null && !NEVER_SCHEMES.has(scheme)) return;
  a.removeAttribute("href");
}

/** Zweite Verteidigungslinie nach dem Rendern: aktive Elemente entfernen, `src`/`srcset` überall löschen, gefährliche Link-Ziele kappen. */
export function stripActiveContent(el: HTMLElement): void {
  for (const n of Array.from(el.querySelectorAll(ACTIVE_TAGS))) n.remove();
  const walk = (node: Element): void => {
    node.removeAttribute("src");
    node.removeAttribute("srcset");
    if (node.tagName.toLowerCase() === "a") sanitizeHref(node);
    for (const c of Array.from(node.children)) walk(c);
  };
  walk(el);
}
