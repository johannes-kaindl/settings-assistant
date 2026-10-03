# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.

Workspace-weite Standards (comply-or-explain): [`../../_docs/CONVENTIONS.md`](../../_docs/CONVENTIONS.md). Dach-Regeln (Kit-first, Zuständigkeit, UI-STANDARD): [`../AGENTS.md`](../AGENTS.md).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-10-03: Repo-Gerüst (Task 0), noch kein Fachcode.** Spec und Plan liegen im Cockpit (Vault `25_Coding/settings-assistant/_SDD/`): `2026-10-03-settings-assistant-design.md` und `2026-10-03-settings-assistant-plan.md`. Reihenfolge: Spec lesen, Plan-Task nehmen, TDD, Gate.

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
- Geheimnis = Name passt (`apikey`, `api_key`, `token`, `secret`, `password`, `credential`, `cookie`, `email`, `/auth(?!or)/`) und Wert ist nicht-leerer Text oder Objekt/Liste. Geheimnisse verlassen das Plugin nie (kein Profil, kein LLM, keine API).
- Schnappschuss vor jedem Schreiben; scheitert er, wird nichts geschrieben. Bei Fehler anhalten, nie automatisch zurückrollen.
- Ein Anwenden zur Zeit (auch über die API). Das eigene Plugin wird nie aus-/eingeschaltet.
- UI nach `UI-STANDARD.md` §8 (Hilfe-Zeile zuerst, Confirm-Kanon, Status-Vokabel `is-checking`/`is-ok`/`is-error`/`is-warning`, nur Theme-CSS-Variablen). Alle UI-Texte in `src/i18n/strings.ts` (en + de).

## Commands

```bash
npm install
npm run gate          # lint, typecheck, typecheck:test, typecheck:scripts, test, check:pure, build
npm test              # vitest
bash tools/sync-kit.sh [--check]
npm run release       # delegiert an ../tools/release/release.mjs
```

## Conventions

Conventional Commits, nur berührte Dateien per Pathspec (nie `git add -A`), Gate per `&&` vor dem Commit. Markdown: ein Absatz, eine Zeile. Release-Infra ist die zentrale (`../tools/release/`); lokale Release-Skripte sind ein Rückstand.

## Gotchas

- `tools/sync-kit.sh` ist byte-gleich zur Vorlage `../tools/kit-sync/sync-kit.sh`; nicht anpassen.
- Die Modulliste in `tools/kit-sync.json` braucht `folder-suggest` und `collapsible` (Abhängigkeiten von `settings_walker` und `request-section`); ungenutzte Module darf Task 18 entfernen.
- `code-kit` ist auf 0.9.0 gepinnt; Task 7 hebt den Pin auf 0.10.0.

## Memory

Cockpit: `25_Coding/settings-assistant/` im Arbeits-Vault. Task-Reports der Plan-Ausführung unter `.superpowers/sdd/` (gitignored).

## Abweichungen von der Leitkonvention

Keine.
