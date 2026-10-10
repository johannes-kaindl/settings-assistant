# Settings Assistant

> [🇬🇧 English](https://github.com/johannes-kaindl/settings-assistant/blob/main/README.md) · 🇩🇪 Deutsch

**Einstellungen von App und Plugins über geprüfte Profile oder einen Chat mit einem lokalen LLM ändern — Geheimnisse bleiben draußen, vor jedem Schreiben steht ein Diff, Schnappschüsse erlauben das Zurückholen.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://github.com/johannes-kaindl/settings-assistant/blob/main/LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](https://github.com/johannes-kaindl/settings-assistant/blob/main/LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/settings-assistant?label=release)](https://github.com/johannes-kaindl/settings-assistant/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.11.4%2B%20·%20desktop%20%26%20mobile-7c3aed)

<p align="center"><img src="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/hero.png" width="820" alt="Eine Notiz mit einem Settings-Profil: jeder Schlüssel als Zeile — wird geändert, bereits gesetzt, Schlüssel nicht gefunden und ein gesperrtes Geheimnis — und ein Anwenden-Knopf"></p>

Einstellungen liegen als JSON-Dateien im Konfigurationsordner, und sie von Hand zu ändern geht leicht schief und lässt sich schlecht zurücknehmen. Settings Assistant schaltet einen Prüfschritt dazwischen: Du beschreibst die Änderung als Profil (oder lässt den Chat eines entwerfen), das Plugin vergleicht es mit dem aktuellen Stand, zeigt jeden Unterschied und schreibt nur, was du angehakt hast — nachdem es einen Schnappschuss gesichert hat, den du später zurückholen kannst.

## Funktionen

- **Profile als Notizen.** Ein Codeblock mit der Sprache `settings-profile` enthält die gewünschten Einstellungen. In der Leseansicht zeigt er den Live-Abgleich mit dem Ist-Stand und einen Anwenden-Knopf. Dasselbe Profil in einem anderen Vault angewendet gleicht zwei Vaults an.
- **Ein Diff vor jedem Schreiben.** Jeder Schlüssel wird zu einer Prüfzeile: wird geändert, schon so gesetzt, Schlüssel nicht gefunden, Plugin nicht installiert und so weiter. Zeilen, die etwas ändern würden, sind angehakt, alle anderen nicht. Geschrieben wird erst nach deiner Bestätigung.
- **Geheimnisse reisen nie mit.** Werte unter Namen wie `apiKey`, `token`, `password` oder `authorization` bleiben aus Profilen, Chat-Kontext, gespeicherten Notizen und der API heraus. Sie erscheinen als gesperrte Zeile mit einem Knopf zu den Einstellungen des Plugins. Schnappschüsse kopieren eine Datei unverändert samt Geheimnissen und bleiben in deinem Konfigurationsordner; siehe [Why secrets never travel](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/explanation-secrets.md#where-the-rule-stops) (Englisch).
- **Schnappschüsse und Zurücknehmen.** Vor jedem Schreiben werden die betroffenen Dateien gesichert. Der Befehl **Letztes Anwenden zurücknehmen** und die Schnappschuss-Liste in den Einstellungen holen sie zurück, mit einer Prüfung je Datei, ob sie sich seither geändert hat.
- **Ein Einstellungs-Chat.** Ein Chat in der Seitenleiste mit deinem lokalen Modell entwirft aus einer Frage ein Profil. Du siehst genau, was gesendet wurde, welche Schlüssel zurückgehalten wurden und den rohen Profilblock. Der Chat schreibt nie von selbst.
- **Auch Hotkeys.** Neben der `data.json` jedes Plugins kann Version 1 die `hotkeys.json` schreiben. Die übrigen Obsidian-Dateien werden gelesen und erscheinen als Zeilen „nur lesbar“.
- **Für andere Plugins.** Eine kleine, versionierte API bietet geschwärztes Lesen, einen Plan und einen Schreibweg mit eigenem Bestätigungsdialog. Siehe [`docs/API.md`](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/API.md).
- **Modellagnostisch und lokal.** Kein Modellname ist fest eingebaut. Endpunkte kommen vom LLM Endpoint Manager, falls installiert, sonst aus einer lokalen Liste in den Einstellungen. API-Schlüssel dieser Liste liegen im Schlüsselbund von Obsidian, nicht in der `data.json`.
- **Zweisprachige Oberfläche.** Englisch ist kanonisch; die Oberfläche folgt der Anzeigesprache von Obsidian und bringt eine vollständige deutsche Übersetzung mit.

## Voraussetzungen

- **Obsidian 1.11.4+** (Desktop oder Mobil; der Chat ist mobil noch nicht gemessen). Die Version ist die Untergrenze, weil API-Schlüssel im Schlüsselbund von Obsidian liegen.
- **Nur für den Chat:** ein OpenAI-kompatibler lokaler Server mit geladenem Chat-Modell, etwa [LM Studio](https://lmstudio.ai), [Ollama](https://ollama.com) oder MLX — oder das Plugin LLM Endpoint Manager, das die Endpunkte liefert. Neu bei lokalen LLMs? Der **[Setup-Guide für lokale LLMs](https://uplink.jkaindl.de/llm-setup)** führt dich von Server über Modell bis zum Zugriff. Profile in Notizen funktionieren ohne jedes Modell.
- **In Version 1 nicht enthalten:** Erscheinungsbild und CSS sowie das Schreiben von `app.json`, `appearance.json`, `core-plugins.json` und `community-plugins.json`. Siehe [Known limits](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/reference-known-limits.md) (Englisch).

## Installation

### Manuell

Das Plugin ist noch nicht im Community Store. Lade `main.js`, `manifest.json` und `styles.css` aus dem [neuesten Release](https://github.com/johannes-kaindl/settings-assistant/releases) nach `<Vault>/.obsidian/plugins/settings-assistant/` (nimm deinen Konfigurationsordner, falls er nicht `.obsidian` heißt) und aktiviere **Settings Assistant** unter **Einstellungen → Community-Plugins**.

### Aus dem Quellcode

```bash
git clone https://github.com/johannes-kaindl/settings-assistant
cd settings-assistant
npm install
npm run build   # erzeugt main.js
```

## Verwendung

1. Schreibe ein Profil in eine beliebige Notiz. Die Leseansicht zeigt dann den Abgleich:

   ````markdown
   ```settings-profile
   {
     "version": 1,
     "plugins": {
       "my-plugin": { "maxRounds": 20 }
     },
     "notes": {
       "plugins.my-plugin.maxRounds": "Kürzere Läufe auf dem Arbeitsrechner."
     }
   }
   ```
   ````

2. Drücke **N Änderung(en) anwenden**. Ein Dialog listet die Zeilen nach Datei gruppiert; hake ab, was du nicht willst, und bestätige. Ein eingeschaltetes Plugin wird ausgeschaltet, beschrieben und wieder eingeschaltet, offene Ansichten davon schließen sich.
3. Fragen statt schreiben: Führe **Einstellungs-Chat öffnen** aus (oder nimm das Ribbon-Symbol), nenne in deiner Frage ein Plugin und lies die Antwort. Ein vorgeschlagenes Profil erscheint mit denselben Zeilen und demselben Anwenden-Knopf; **Als Profilnotiz speichern** hebt es für einen anderen Vault auf.
4. Zurücknehmen: Führe **Letztes Anwenden zurücknehmen** aus oder wähle in den Einstellungen unter **Schnappschüsse** einen Schnappschuss. Eine Datei, die sich seit dem Anwenden geändert hat, wird so angezeigt und ist nicht angehakt.

<img src="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/apply-dialog.png" width="550" alt="Der Dialog Settings anwenden: Zeilen je Plugin gruppiert mit Häkchen, Neuladen-Hinweis, gesperrte Geheimnis-Zeile und der Knopf Apply 3 changes">

<a href="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/chat.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/thumbs/chat.png" width="380" alt="Der Einstellungs-Chat in der Seitenleiste mit einem entworfenen Profil, seinen Prüfzeilen und einem Anwenden-Knopf"></a><br><sub>Auf die Vorschau klicken für den Chat in voller Größe</sub>

<img src="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/restore-dialog.png" width="550" alt="Der Dialog Schnappschuss zurückholen mit einer Datei, seit dem Anwenden unverändert">

Die Anleitung [First profile](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/tutorial-first-profile.md) (Englisch) geht all das einmal Schritt für Schritt durch.

## Konfiguration

**Einstellungen → Community-Plugins → Settings Assistant**, von oben nach unten:

| Einstellung | Was sie tut |
|---|---|
| Hilfe | Öffnet die Dokumentation und den Issue-Tracker. |
| Endpunkt | Mit installiertem LLM Endpoint Manager: einen Endpunkt wählen oder den ersten erreichbaren gewinnen lassen. Ohne ihn: eine geordnete Liste OpenAI-kompatibler Server, je mit optionalem API-Schlüssel und Modell, Verbindungsstatus und Knopf **Verbindung prüfen**. |
| Request | Die tatsächlich gesendeten Sampling-Werte, Denkstufe und das Token-Budget für die aktuelle Modellfamilie, dazu die letzte Anfrage und Abweichungen der Sitzung. |
| Aufbewahrung | Wie viele Schnappschüsse bleiben: **Behalten von heute**, **Behalten je Tag**, **Behalten je Woche**, **Behalten je Monat**. Standard 6, 7, 4 und 6; 0 behält für den Zeitraum keinen. |
| Gespeicherte Schnappschüsse | Die Liste der Schnappschüsse, neueste zuerst. Ein Klick öffnet den Zurückholen-Dialog. |

<a href="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/settings.png"><img src="https://raw.githubusercontent.com/johannes-kaindl/settings-assistant/main/docs/images/thumbs/settings.png" width="380" alt="Der Abschnitt Snapshots der Einstellungen: Aufbewahrungsfelder und die Liste der gespeicherten Schnappschüsse"></a><br><sub>Auf die Vorschau klicken für den Abschnitt in voller Größe</sub>

## Funktionsweise

Alles Fachliche steckt in einem reinen Kern ohne Obsidian-Import: ein Profil parsen, es mit den Dateien abgleichen, Geheimnisse erkennen, JSON patchen und dabei unbekannte Schlüssel, Reihenfolge und Einrückung erhalten, und entscheiden, was ein Zurückholen anfassen darf. Ein Gate hält diese Grenze, deshalb wird der Kern in reinem Node getestet.

Alle drei Eingänge — Notiz, Chat und API — liefern ein Profil und eine Herkunft an einen Schreibweg: Dateien lesen, abgleichen, den Dialog zeigen, einen Schnappschuss sichern (scheitert das, wird nichts geschrieben), jede Datei schreiben, zurücklesen und melden, was das Plugin korrigiert hat. Bei einem Fehler hält er an und bietet ein Zurückholen an, statt selbst zurückzurollen. Es läuft immer nur ein Anwenden.

Geschrieben werden nur `plugins/<id>/data.json` fremder Plugins und die `hotkeys.json`. Die eigene `data.json` des Plugins wird nie über ein Profil geschrieben, und das Plugin schaltet sich nie selbst aus oder ein.

## Dokumentation

Die Doku ist auf Englisch.

- [Documentation index](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/README.md) — alle Seiten an einem Ort.
- [Getting started: First profile](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/tutorial-first-profile.md) — von der Installation bis zur ersten angewendeten Änderung.
- [Troubleshooting](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/troubleshooting.md) — die genaue Meldung, ihre Ursache und die Abhilfe.
- [Align two vaults](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/howto-align-two-vaults.md) und [Ask the chat](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/howto-ask-the-chat.md) — Anleitungen.
- [Profile format](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/reference-profile-format.md), [Check rows](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/reference-check-rows.md) und [Known limits](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/reference-known-limits.md) — Nachschlagewerk.
- [Why secrets never travel](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/explanation-secrets.md) und [Snapshots and retention](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/explanation-snapshots.md) — Hintergrund.
- [Plugin API v1](https://github.com/johannes-kaindl/settings-assistant/blob/main/docs/API.md) — für Plugin-Autoren (auf Englisch).

## Mitwirken

- [`AGENTS.md`](https://github.com/johannes-kaindl/settings-assistant/blob/main/AGENTS.md) — Architektur, Konventionen und Stolpersteine für Mitwirkende und KI-Agenten.
- [`CHANGELOG.md`](https://github.com/johannes-kaindl/settings-assistant/blob/main/CHANGELOG.md) — was sich je Release geändert hat.

## Lizenz

Code AGPL-3.0-or-later ([`LICENSE`](LICENSE)), Dokumentation CC BY-SA 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

## Danksagung

Aus Config Sync (MIT, xooooooooox/obsidian-config-sync) haben wir für mehrere Randfälle gelernt. Es wurde kein Code kopiert.
