# Aufnahme-Vertrag — README-Bilder

Dieser Ordner hält die Bilder, die `README.md` und `README.de.md` einbetten. Diese Datei ist der Vertrag dafür: welche Bilder es gibt, was jedes zeigen muss, in welcher Klasse es steht und wie man sie reproduzierbar neu aufnimmt. `readme_lint.py` gleicht Vertrag, Dateien und Einbettungen ab.

## Status

Stand 2026-10-03: alle fünf Bilder stehen, aufgenommen in einer Zweitinstanz (Profil und Port gehören dem Treiber, Oberfläche Englisch). Die Bilder zeigen ein Demo-Plugin „Quick Capture“ mit erfundenen, generischen Einstellungen; es läuft kein Sprachmodell, der Chat antwortet ein lokaler Fake-Endpunkt mit einer festen Antwort.

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard (`_docs/readme/readme-spec.json`, Block `images`): `hero` und `feature` mit `width="820"`, `detail` als 380-px-Vorschau aus `thumbs/`, verlinkt auf die Vollauflösung; Einbettung per `<img width>` mit absoluter Raw-URL und Alt-Text; PNG höchstens 400 KB; helles Standard-Theme.

## Die Bilder

| Datei | Klasse | Referenziert von | Muss zeigen |
|---|---|---|---|
| `hero.png` | hero | `README.md`, `README.de.md` (Kopf) | Die Notiz „Weekly review setup“ in der Leseansicht: der `settings-profile`-Block als Prüfzeilen — will change, already set, key not found und die gesperrte Zeile `apiKey` mit „Open settings“ — darunter der Knopf „Apply 4 changes“. |
| `apply-dialog.png` | feature | `README.md`, `README.de.md` (Usage) | Der Dialog „Apply settings“: Zeilen unter `plugins.quick-capture` mit Häkchen (drei angehakt, `timestampFormat` nicht), der Hinweis „quick-capture will be reloaded — open views close.“, die gesperrte Zeile und „Apply 3 changes“. |
| `chat.png` | detail | `README.md`, `README.de.md` (Usage) | Die Chat-Seitenleiste mit Frage, Antwort, dem Profil als Prüfzeilen, „Apply 2 changes“, „Raw block (secrets redacted)“, „Save as profile note“ und „Sent context“. |
| `restore-dialog.png` | feature | `README.md`, `README.de.md` (Usage) | Der Dialog „Restore snapshot“ nach einem Anwenden, mit `.obsidian/plugins/quick-capture/data.json`, „unchanged since the apply — will be restored“ und „Restore 1 file“. |
| `settings.png` | detail | `README.md`, `README.de.md` (Configuration) | Der Abschnitt „Snapshots“ des Einstellungen-Tabs: Retention-Felder und „Saved snapshots“ mit einem Eintrag. |

## Reproduktion

Der Treiber startet und beendet seine Zweitinstanz selbst (nur den eigenen Prozess), baut den Vault vor jedem Lauf aus `fixture/` und setzt Demo-Daten und Schnappschüsse zurück.

```bash
npm run build
lsof -nP -iTCP:9400 -sTCP:LISTEN                 # Port frei?
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "shots.ts" --exclusive focus --port 9400 --ttl 600
npm run shots -- --port 9400                      # alles aufnehmen
npm run shots -- --port 9400 --only chat.png      # ein Bild nachziehen
npm run shots -- --list                           # Vertrag anzeigen
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
npm run shots:check                               # Vertrag, Dateien, Einbettung abgleichen
```

Der Fake-Endpunkt bindet den festen Port 8765 (nicht 1234: dort hält LM Studio einen Wildcard-Bind). Nach jedem Bild werden Dialoge geschlossen und gemessen, dass keiner offen blieb; ein stehengebliebener Dialog stand sonst als Geist im Folgebild.
