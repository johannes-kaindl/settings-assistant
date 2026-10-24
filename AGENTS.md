# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

Workspace-weite Standards (comply-or-explain): [`../../workspace/_docs/CONVENTIONS.md`](../../workspace/_docs/CONVENTIONS.md). Dach-Regeln (Kit-first, Zuständigkeit, UI-STANDARD): [`../AGENTS.md`](../AGENTS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-10-03:** Bau-Tasks 0–17c sind fertig und abgenommen, Version 0.1.0 ist release-reif, aber nicht veröffentlicht (den Release fährt der Master nach Johannes' Freigabe, CORE-AGENT-14). Spec und Plan liegen im Cockpit (Vault `25_Coding/settings-assistant/_SDD/`): `2026-10-03-settings-assistant-design.md` und `2026-10-03-settings-assistant-plan.md`. Nutzer-Doku: `README.md` (EN, kanonisch), `README.de.md`, `docs/` nach Diátaxis mit Einstieg `docs/README.md` (die Hilfe-Zeile im Einstellungs-Tab verlinkt genau dorthin); die Anbieter-API steht in `docs/API.md`.

## Project character

**Projekt:** `settings-assistant` (manifest-`id`, Name „Settings Assistant“) — Obsidian-Plugin, das Einstellungen von Obsidian und seinen Plugins gezielt, nachvollziehbar und rückholbar ändert: über geprüfte Profile (Codeblock `settings-profile`) oder einen Chat mit einem lokalen LLM. Vor jedem Schreiben steht ein Diff, Geheimnisse bleiben draußen, Schnappschüsse erlauben das Zurückholen. Autor: Johannes Kaindl.

**Vorgänge v1:** A — Werte in einer Plugin-`data.json` setzen · B — Einstellungen zwischen Vaults angleichen (Profil-Notiz als Quelle) · C — Hotkeys setzen. Erscheinungsbild/CSS ist ausdrücklich draußen.

**Modellagnostik ist Pflicht:** kein hartkodierter Modellname, Endpunkte über `endpoint-source` (llm-endpoint-manager), Sampling über die Kit-Tabelle `sampling-profiles`.

## Architecture principles

**PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** Alles Fachliche liegt in `src/core/` und ist in Node testbar; `npm run check:pure` nagelt das fest. Nur `main.ts`, Settings-Tab, Views und IO-Adapter importieren `obsidian`.

**Kit-first:** Geteilter Code kommt vendored aus `obsidian-kit` und `code-kit` (`tools/kit-sync.json`, `bash tools/sync-kit.sh`, `--check` misst Drift). Vendorte Dateien unter `src/vendor/` und `tests/vendor/` werden nie von Hand editiert. Übernommene Dateien tragen in Zeile 1 `// uebernommen aus <repo>/<pfad>, <YYYY-MM-DD>`.

**Global Constraints des Plans (Stichworte):**

- Schreibbar in v1 nur `<configDir>/plugins/<id>/data.json` und `<configDir>/hotkeys.json`; die eigene `data.json` nie über ein Profil.
- Pfade über `app.vault.configDir`, nie `".obsidian"`; Dateizugriff nur über `app.vault.adapter`, nie `fs`.
- Geheimnis = Name passt (`apikey`, `api_key`, `api-key`, `token`, `secret`, `password`, `credential`, `cookie`, `email`, `/auth(?!or(?!iz))/` — `authorization`, `authorize`, `oauth` sind geheim, `author`, `authorUrl`, `authors` frei) und Wert ist nicht-leerer Text oder Objekt/Liste. Geheimnisse verlassen das Plugin nie (kein Profil, kein LLM, keine API).
- Schnappschuss vor jedem Schreiben; scheitert er, wird nichts geschrieben. Bei Fehler anhalten, nie automatisch zurückrollen.
- Ein Anwenden zur Zeit (auch über die API). Das eigene Plugin wird nie aus-/eingeschaltet.
- UI nach `UI-STANDARD.md` §8 (Hilfe-Zeile zuerst, Confirm-Kanon, Status-Vokabel `is-checking`/`is-ok`/`is-error`/`is-warning`, nur Theme-CSS-Variablen). Alle UI-Texte in `src/i18n/strings.ts` (en + de).

## Architecture

Der reine Kern liegt in `src/core/` (kein `obsidian`-Import, `npm run check:pure` nagelt das fest), die dünnen Adapter in `src/obsidian/`. Modul für Modul steht es in [`docs/internal/architecture.md`](docs/internal/architecture.md) — lesen, bevor du `src/core/` oder die Adapter anfasst.

## Befehle und Eingänge

- Befehle: `undo-last-apply` („Undo last apply“), `open-chat` („Open settings chat“); dazu ein Ribbon-Symbol (`sliders-horizontal`) für den Chat und der Codeblock-Prozessor `settings-profile`.
- Drei Eingänge, ein Schreibweg: Profil-Notiz (Herkunft `note:<pfad>`), Chat (`chat:<zeit>/<modell>`), API (`api:<aufrufer>`); ein Zurückholen trägt `restore:<ordner>`.
- Die API (`docs/API.md`) öffnet beim Schreiben immer den eigenen Dialog (`confirms: "provider"`); es gibt keinen Parameter, der die Bestätigung umgeht.

## Commands

```bash
npm install
npm run gate          # lint, typecheck, typecheck:test, typecheck:scripts, test, check:pure, build
npm test              # vitest
bash tools/sync-kit.sh [--check]
npm run release       # delegiert an ../tools/release/release.mjs
```

**GUI-Smoke (P1–P19)** gegen eine Obsidian-Zweitinstanz mit eigenem Profil und Port 9361, der Treiber startet und beendet sie selbst und baut den Vault VOR jedem Lauf aus `fixtures/vault/` (Testplugin `sa-probe` aus `fixtures/plugins/sa-probe/` korrigiert beim Laden einen Wert und speichert beim Abschalten). Orts- und Lock-Regeln stehen im Dach-`../AGENTS.md`, Abschnitt „Staging-Vaults: ein Ort, eine Variable“:

```bash
npm run build
lsof -nP -iTCP:9361 -sTCP:LISTEN   # Port frei?
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label settings-assistant --intent "GUI-Smoke :9361" --exclusive focus --port 9361 --ttl 300
npm run smoke:gui -- --launch --port 9361
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

`release` gehört unmittelbar hinter den Lauf. Ohne den Lock blockt der CDP-Guard den Treiber.

## Conventions

Conventional Commits, nur berührte Dateien per Pathspec (nie `git add -A`), Gate per `&&` vor dem Commit. Markdown: ein Absatz, eine Zeile. Release-Infra ist die zentrale (`../tools/release/`); lokale Release-Skripte sind ein Rückstand.

## Gotchas

- `tools/sync-kit.sh` ist byte-gleich zur Vorlage `../tools/kit-sync/sync-kit.sh`; nicht anpassen. Kit-Stände sind fest gepinnt (Ref je Quelle in `tools/kit-sync.json`, alle Module einer Quelle auf derselben Ref). Seit Task 18 sind nur benutzte Module gelistet; `folder-suggest` und `collapsible` bleiben, weil `settings_walker` und `request-section` sie brauchen. Wer ein Modul entfernt, prüft vorher die Importe innerhalb der vendorten Dateien (transitiv), danach `bash tools/sync-kit.sh && bash tools/sync-kit.sh --check` und `git rm` der Dateien. Entfernt in Task 18: `confirm`, `lab-client`, `think-toggle`; `stable-writer` und `stream-blocks` sind seit Welle 26 wieder vendort, weil `chat-window` (das Kit-Chatfenster) sie braucht.
- `minAppVersion` ist 1.11.4, weil die API-Schlüssel der lokalen Endpunkt-Liste im Schlüsselbund (`app.secretStorage`) liegen; Klartext-Schlüssel werden beim ersten Start migriert und aus der `data.json` entfernt. Wo der Schlüsselbund fehlt, bliebe der Klartext bis zur Migration stehen (CHANGELOG „Known issues“).
- `ProfileError.detail` (rohe `JSON.parse`-Meldung) wird NIE angezeigt, gespeichert, geloggt, in den Chat-Kontext oder über die API gegeben: V8 hängt dem Fehler den Quelltext an, und der kann ein Geheimnis enthalten. Konsumenten zeigen nur `code`; die API gibt nur das Wort zurück.
- `neutralizeModelMarkdown` läuft (im Schreiber des Kit-Chatfensters) über jede Chat-Antwort, bevor sie gerendert wird: `MarkdownRenderer` lädt Bilder, Embeds und HTML von selbst und führt die Codeblock- und Inline-Prozessoren ALLER Plugins aus (Dataview-JS `dataviewjs`/`$=` wäre Codeausführung), und Modellausgabe ist nicht vertrauenswürdig. Strategie „entfernen statt erkennen“: jedes Backtick wird `ˋ` (U+02CB), jede Folge von ≥ 3 Tilden `˜` (U+02DC) — so entsteht weder Zaun noch Inline-Code, egal welche Zeilenenden, Einzüge oder Span-Längen der Renderer anders liest als eine Regex. Code-Formatierung in Antworten geht dafür verloren (akzeptiert). `stripProfileBlocks` läuft als `answerTransform` je stabilem Abschnitt vorher. Links bleiben (ein Klick ist eine Nutzerhandlung), aber ihre Ziele kappt `src/obsidian/dom-safety.ts` (`stripActiveContent`: `javascript:`, `data:`, `file:`, `obsidian://`, `app:`) — das Kit-`domGuard` tut das ausdrücklich nicht; befristet hier bis zur Kit-Task „Linkschutz in Modellantworten“.
- Eigener-Plugin-Schutz: `settings-assistant` wird nie über ein Profil geschrieben (Prüfzeile `read-only`), nie aus- oder eingeschaltet (`plugin-host.ts` wirft `self`), nicht über `readSettings` ausgegeben (`own-settings`) und fehlt in der Plugin-Liste des Chats. Grund: ein Neuladen mitten im Anwenden würde die eigene Oberfläche löschen.
- Der Vertrauens-/Restricted-Mode-/`.asar`-Vorlauf einer frischen Zweitinstanz steht im Dach-`../AGENTS.md`; der Treiber erledigt ihn selbst. Der erste Lauf nach Profilanlage ist ein Aufwärmlauf und zählt nicht.
- Schnappschüsse kopieren die Datei unverändert, Geheimnisse eingeschlossen; sie bleiben im Konfigurationsordner des Vaults und werden nie angezeigt oder gesendet. Die Doku sagt das offen (`docs/explanation-secrets.md`); das ist keine Lücke, die ein Schwärzen im Schnappschuss schließen dürfte, weil das Zurückholen sonst die Geheimnisse löschen würde.
- Zahlenschlüssel wie `"10"` sortiert JavaScript in Objekten nach vorn (siehe `patch.ts`, im CHANGELOG unter „Known issues“).
- Doku ist eine Zusage (CORE-META-18): Bei jeder Änderung an Befehlen, Einstellungs-Bezeichnungen, Prüfzeilen-Texten oder Fehlertexten die Stellen in `README.md`, `README.de.md` und `docs/` mit dem Wortlaut aus `src/i18n/strings.ts` gegenhalten; die Nutzer-Doku zitiert diese Texte wörtlich.

## Memory

Cockpit: `25_Coding/settings-assistant/` im Arbeits-Vault. Task-Reports der Plan-Ausführung unter `.superpowers/sdd/` (gitignored).

## Abweichungen von der Leitkonvention

Keine.

## UI-Abweichungen

Keine. `python3 ../tools/ui_adoption_check.py` meldet für dieses Repo keinen Rückstand (Stand 2026-10-03). Zwei Bauarten sind nur der Vollständigkeit halber festgehalten, keine Abweichungen: Der Einstellungs-Tab ist deklarativ (`getSettingDefinitions()`) und führt die Hilfe-Zeile deshalb als `helpSettingDefinition(...)` statt `buildHelpSetting(...)`, das ist die in UI-STANDARD §8 für deklarative Tabs vorgesehene Form. Die Schnappschuss-Liste ist eine Kit-`version-list`, deren Zeilenklick den Zurückholen-Dialog öffnet, statt einen eigenen Zurückholen-Knopf je Zeile zu tragen; das Kit-Modul setzt dabei `aria-pressed="false"` auf einen Aktionsknopf (CHANGELOG „Known issues“, Kit-Task angelegt).
