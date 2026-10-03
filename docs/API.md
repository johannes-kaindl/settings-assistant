# Plugin-API v1

`settings-assistant` (Einstellungen per Profil oder Chat ändern, mit Diff, Schnappschuss und ohne Geheimnisse) bietet anderen Obsidian-Plugins eine schmale, versionierte API an: geschwärztes Lesen von Einstellungen, einen Plan (schreibt nie), einen Schreibweg mit eigenem Bestätigungsdialog und zwei Werkzeug-Definitionen für fremde Agenten-Loops.

Implementierung: `src/obsidian/api.ts` (`createSettingsAssistantApi`). Muster ist `calendar-notes/docs/API.md`; der Unterschied steht in Regel 5.

## Zugriff

```ts
const sa = app.plugins.plugins["settings-assistant"]?.api;
if (sa?.apiVersion === 1) {
  const r = await sa.readSettings({ plugin: "calendar-notes" });
}
```

## Konsumenten-Regeln (verbindlich für jeden Aufrufer)

1. **Bei jedem Aufruf frisch lesen, nie beim Laden cachen.** `settings-assistant` kann zur Laufzeit deaktiviert werden, der Zugriff über `app.plugins.plugins[...]` ist nur ein Objekt-Lookup.
2. **`apiVersion` prüfen, bevor du dich auf die Form verlässt.** Die Zahl erhöht sich bei jeder brechenden Änderung; ein Konsument, der eine andere Version sieht, behandelt die API als nicht vorhanden statt zu raten.
3. **Typen kopieren statt importieren, mit Herkunftsstempel.** Beide Plugins sind eigenständige Store-Repos ohne Build-Kopplung; die Versionsnummer ersetzt den Compiler.
4. **`{ error }` prüfen, nie auf einen Wurf hoffen.** Jede Methode fängt intern und liefert `{ error: string }`; `error` ist ein rohes, unübersetztes Diagnosewort, nie ein Text mit Dateiinhalt.
5. **Die API öffnet beim Schreiben IMMER den eigenen Dialog — `confirms: "provider"`.** Das ist die bewusste Umkehrung des `calendar-notes`-Musters: Eine öffentliche `.api` auf `.obsidian` darf kein stiller Schreibzugang sein. Ein Wirt überspringt dafür seine eigene Bestätigung, zeigt den Plan aber weiterhin an. Es gibt keinen Parameter, der die Bestätigung umgeht.

## Methoden

```ts
apiVersion: 1
status(): { busy: boolean; writable: string[]; stage: "v1" }
readSettings(q: { plugin: string } | { file: ObsidianFile }): Promise<{ settings: Json | null; redacted: string[] } | ApiError>
planProfile(profile: unknown): Promise<{ rows: ApiCheckRow[] } | ApiError>
applyProfile(profile: unknown, opts: { origin: string }): Promise<{ results: Array<{ path: string; outcome: RowOutcome; actual?: Json }>; snapshot: string | null } | { cancelled: true } | { busy: true } | ApiError>
tools(): ApiToolDefinition[]
execute(name: string, args: unknown): Promise<unknown>
```

- `status()` ist synchron und netzfrei. `writable` nennt die beschreibbaren Ziele als Text: `plugins/*/data.json` und die freigegebenen Obsidian-Dateien (in Stufe 1 nur `hotkeys`). `busy` ist `true`, solange ein Schreib- oder Zurückhol-Vorgang läuft.
- `readSettings` liest ein installiertes Plugin (`{ plugin }`) oder eine Obsidian-Datei (`{ file }`: `app`, `appearance`, `hotkeys`, `core-plugins`, `community-plugins`). Das Ergebnis ist IMMER geschwärzt: geheime Werte erscheinen als `🔒`, `redacted` nennt deren Pfade. Fehlt die Datei, ist `settings` `null`. Die eigenen Einstellungen von `settings-assistant` werden nicht ausgegeben.
- `planProfile` schreibt nichts. `profile` ist ein Objekt oder JSON-Text im Profil-Format (`version: 1`, `plugins`, Obsidian-Dateien, `notes`). `ApiCheckRow` trägt `target` (z. B. `plugins.foo`), `path` (Punktpfad), `status` und, falls vorhanden, `current`, `desired`, `note`. Eine Zeile mit Status `secret` trägt nur `target`, `path` und `status`.
- `applyProfile` zeigt Diff und Auswahl im eigenen Dialog und schreibt erst nach Bestätigung des Menschen, mit Schnappschuss vor dem Schreiben. `origin` benennt den Aufrufer und wird als `api:<origin>` im Schnappschuss-Manifest gespeichert (höchstens 80 Zeichen, keine Steuer- oder Zeilenumbruchzeichen, sonst `api:unknown`). `snapshot` ist der Schnappschuss-Ordner oder `null`.
- `{ cancelled: true }` heißt: der Mensch hat den Dialog verworfen, es wurde nichts geschrieben. `{ busy: true }` heißt: ein anderer Vorgang läuft, später erneut versuchen.

## Werkzeuge

| Name | writes | confirms | Parameter |
|---|---|---|---|
| `read_settings` | `false` | `caller` | `{ plugin?: string; file?: string }` (genau eines von beiden) |
| `propose_settings` | `true` | `provider` | `{ profile: object }` |

`execute(name, args)` prüft die Argumente. `propose_settings` ruft `applyProfile` mit dem Herkunftsnamen `propose_settings` und öffnet damit den eigenen Dialog.

## Fehlerwörter

- `bad-args`: Argumente fehlen, haben die falsche Form, oder eine Plugin-ID ist ungültig.
- `own-settings`: `readSettings` für `settings-assistant` selbst.
- `not-installed`: das Plugin ist nicht installiert.
- `unreadable`: die Datei ist keine gültige JSON-Datei.
- `unknown-tool`: `execute` kennt den Namen nicht.
- `failed`: unerwarteter Fehler im Plugin oder beim Schreiben; der Text bleibt im Plugin.
- `invalid-profile`: das Profil lässt sich nicht als JSON serialisieren.
- Profilfehler, jeweils das Wort des Parsers: `invalid-json`, `not-object`, `missing-version`, `bad-version`, `future-version`, `bad-section`.

## Beispiel: Koda (Tool-Calling, der Anbieter bestätigt)

```ts
const sa = app.plugins.plugins["settings-assistant"]?.api;
if (sa?.apiVersion !== 1) return;
const tools = sa.tools();                      // ins Tool-Register des Agenten-Loops
// … das Modell wählt propose_settings und liefert ein Profil …
const r = await sa.execute("propose_settings", { profile });
// Settings Assistant zeigt seinen Diff-Dialog; Koda fragt zusätzlich nicht nach (confirms: "provider").
if ("error" in r) { /* Diagnosewort melden */ }
else if ("cancelled" in r) { /* Mensch hat verworfen */ }
```
