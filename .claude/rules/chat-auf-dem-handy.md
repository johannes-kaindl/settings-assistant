---
paths:
  - "src/main.ts"
  - "src/obsidian/chat-host.ts"
  - "styles.css"
  - "scripts/chat-layout.ts"
  - "tests/styles-tippflaechen.test.ts"
  - "tests/main-chat-ort.test.ts"
---

# Chat auf dem Handy: Ort, Abstand, Tastatur

- Der Chat öffnet auf dem Handy als Tab im Hauptbereich, nicht in der Schublade (`openChat` ruft `openChatLeaf` des Kits, seit 0.77.0: ein in der Schublade gespeichertes Blatt wird dort geschlossen und öffnet im Hauptbereich, der Verlauf lebt im Plugin): in der Schublade hängt Obsidians eigene Tab-Auswahl unter dem Chat (gemessen 155 px unter der Knopfreihe, 2026-11-01, Emulation 390 × 844 und 390 × 508), im Hauptbereich schwebt dafür die Navigationsleiste über dem unteren Rand, und den Platz dafür lässt das Kit (Klasse `okit-chat-host` am `view-content`, `CHAT_WINDOW_CSS` seit 0.76.0); eine eigene Regel mit `padding-bottom` am Wirt `.sa-chat-host` kommt nicht zurück (`tests/styles-tippflaechen.test.ts` wacht darüber): am iPhone setzt Obsidian bei offener Tastatur `--safe-area-inset-bottom` auf die Tastaturhöhe, die alte Regel ergab 380 px Abstand und ließ dem Chat 52 px (Gerät, Master, 2026-11-03). Die Navigationsleiste verschwindet bei offener Tastatur nicht aus dem Dokument, liegt aber hinter ihr; das Fenster schrumpft nicht, nur der App-Container. Die Messung (`chat-layout`) setzt die Tastatur seit Welle 30 wie am Gerät (`--tastaturart geraet`: Variablen und Container, `innerHeight` bleibt), nicht mehr über den Viewport; die Falte unter 640 px Höhe greift am Gerät bei offener Tastatur nie. Das Warum steht in `docs/internal/architecture.md`; die Messung läuft mit `npm run chat-layout -- --port <PORT> --tag <name>` (Lock wie beim Smoke).
