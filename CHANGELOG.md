# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Documentation

- The README describes the Community Store install, and the LLM setup guide links point to the new address.

## [0.6.0] — 2026-10-16

### Fixed

- **Gemma 4 on LM Studio: the model's thinking no longer shows up as the answer in the chat.** It writes its thinking into the answer text without an opening marker and closes it with `<channel|>`; the chat now moves that text into the collapsible thinking block and shows only the answer.
- The chat's thinking button shows "lowest level" for Gemma 4 on LM Studio, where thinking cannot be switched off completely (LM Studio ignores `none` for that model, so "off" sends the lowest effort and the model thinks a little).

### Changed

- **In the chat, Enter sends the message and Shift+Enter starts a new line,** as in the other chat windows. Ctrl+Enter and Cmd+Enter still send. Before, only Ctrl/Cmd+Enter sent.
- **Kit pins raised to `obsidian-kit` 0.61.0 and `code-kit` 0.28.0** (from 0.60.1 and 0.27.1). Visible effects of the skipped releases (obsidian-kit 0.60.2, 0.60.3, 0.61.0; code-kit 0.27.2, 0.28.0): Gemma 4 on LM Studio sends the lowest thinking effort for "thinking off" (see above); the request section names a backend or model family the plugin does not know yet instead of failing; if the LLM Endpoint Manager is switched on after this plugin, the endpoint subscription now catches up instead of staying silent for the session; the snapshot list no longer needs a placeholder for the active entry. Nothing else in the copied building blocks reaches this plugin.

## [0.5.0] — 2026-10-14

### Changed

- Kit pins raised to `obsidian-kit` 0.60.1 and `code-kit` 0.27.1 (from 0.59.1 and 0.24.0). Visible effects of the skipped releases (obsidian-kit 0.60.0, 0.60.1; code-kit 0.25.0, 0.26.0, 0.27.0, 0.27.1):
  - **Chat header:** the thinking button now has a visible gap between its icon and its label (the plugin's stylesheet carries the kit rules).
  - **Request section:** a hint about discarded request settings lists them sorted instead of in stored order.
  - **Snapshot list:** the rows are announced as plain buttons that open the restore dialog, no longer as toggles.
- **Plugin IDs:** the check that keeps a profile or a snapshot from writing outside `plugins/<id>/` now comes from the kit. Besides what it rejected before, it refuses IDs longer than 128 characters, IDs ending in a dot and Windows device names (`con`, `nul`, `com1` …). None of the 8912 IDs of the Community store is affected. The note name `Settings profile YYYY-MM-DD HH-mm` is unchanged.
- **Chat:** the running answer is built once and then only updated, instead of being torn down and rebuilt with every streamed piece. Scrolling, text selection and the open thinking block stay where they are while the answer grows.

## [0.4.1] — 2026-10-12

### Changed

- **Endpoint rows:** the "move up" and "remove endpoint" buttons stay together, and the address and the model ID stay fully visible at normal width; in a narrow window the block of model and buttons moves as a whole into a second line (obsidian-kit 0.59.0–0.59.1). The key field gives way first, so its placeholder may be shortened.
- **Request section:** for a model whose family or backend is not known yet, the section now reads "Family: not detected yet · Backend: not detected yet" and notes that this is normal for a freshly added endpoint (it was "unknown"; obsidian-kit 0.59.0).
- **Chat:** scrolling up while a reply streams keeps your position, as before. The kit now follows the end by itself; the chat tells it whether you were at the bottom, so the view does not jump back.
- Kit pins moved to obsidian-kit 0.59.1 and code-kit 0.24.0 (skipping obsidian-kit 0.56.1–0.58.0, whose changes nothing in the plugin shows).

## [0.4.0] — 2026-10-12

### Changed

- **The endpoint list shows the context length.** Under a reachable row with a model it now reads "Context: loaded N · max M tokens" (only "max M" when the model is not loaded, nothing when the server names no number). The line comes from the shared kit and asks LM Studio or Ollama after the status check.
- **A row's model can be set back to "— (server picks)".** The model selection of every row offers this option again (the "global model" option stays gone): choosing it removes the model from that row, and the row then sends no model name, as before for an empty row.
- **Clearer status hints.** The tooltips of the status icons and the input hints use the kit's wording (EN/DE): a timeout now says "network unreachable (wrong network / VPN off?)", a server that is not an LLM API says "wrong path/service?", and "Not reachable" no longer ends in a dangling dash.
- **Masking before a request is broader.** Secrets are masked more often on their way to the server: a `Bearer` token is caught in any case and from 8 characters (it was 16, lower case slipped through), also a token with `=` in it. Prose such as "Bearer authentication" is masked too and reaches the server as `Bearer [redacted-token]`.
- **Remote targets in the chat answer.** A link or image target split over a line break, or after a lone carriage return, no longer keeps a remote image alive; a Mermaid diagram that could load something from outside is shown as plain text (the source stays readable) and is not drawn; the check of CSS targets stays linear on long answers. Answers are still shown as text.
- **Long answers render faster and leak less.** The guard against remote targets while an answer streams in checks only what changed (a 100 KB answer took 3.2 s, now 1.3 s in the measurement of the kit) and the removal of a model's `<think>` block is linear (50 000 unclosed `<think>` took seconds, now under a millisecond).
- The shared kit is updated to obsidian-kit 0.56.0 and code-kit 0.23.0 (one step, no intermediate pin).

## [0.3.0] — 2026-10-10

### Changed

- **The Model setting is gone.** The model now lives only in the endpoint row. On the first start after the update, the old value moves once into every endpoint row that has no model of its own, and `localModel` is removed from `data.json`. A value without any endpoint row (no local endpoints at all) is lost; with the LLM Endpoint Manager installed the rows are filled too, but its endpoints still decide.
- A new endpoint row inherits no model any more, and a model that is set in a row can no longer be switched back to "empty" in the row's selection (the option **global model** is gone). A row without a model sends an empty model name: the chat then shows an empty **Model** in the sent context and the snapshot origin reads `chat:<time>/`.
- The shared kit is updated (code-kit 0.17.0). The check for remote targets in the chat answer now treats link and image targets longer than 2048 characters as remote (fail closed), so such a target is neutralised instead of rendered.

## [0.2.0] — 2026-10-09

### Changed

- The chat connection now runs on the shared obsidian-kit connection: endpoint source, endpoint list, model lists, request parameters, the Request section and the check of every answer come from one place. The Settings tab shows them in one block under **Chat model**.
- The wait for the first answer chunk is 10 minutes instead of 5 (a model that loads on demand needs the time). A request that ends at the token limit without any text is still an error, and the deviation **Empty answer: thinking used up the token budget** now also appears in the Request section.
- **Endpoint** (choice at the LLM Endpoint Manager) only applies with the manager installed; without it the first reachable local endpoint is used, as the list says.
- The error text for a missing endpoint is now **No endpoint available — set one up in the plugin settings.** (it was the code `no-endpoint`).
- Without the manager, the **Model** row now sits below the endpoint block and applies to list rows without a model of their own; each row can also pick its own model.
- Secrets are masked before the text leaves the plugin and restored in the answer: tokens, `Bearer` headers and private keys in your question go to the server as placeholders. Answers are shown as text, so an image link carrying a placeholder cannot send a secret out.
- Local API keys are moved from `data.json` into Obsidian's secret storage at the first resolve, as before; this now needs Obsidian 1.11.4 (already the minimum).

## [0.1.1] — 2026-10-03

### Changed

- The README now shows screenshots: a settings profile in a note, the apply dialog, the restore dialog, the chat sidebar and the snapshot settings.

## [0.1.0] — 2026-10-03

### Added

- Profiles as notes: a fenced `settings-profile` block (JSON, `version: 1`) shows a live comparison with the current files in reading view and an apply button.
- Check rows for every key (will change, already set, key not found in file, plugin not installed, file is not valid JSON, path blocked by a non-object value, secret, read-only in this version), with the profile's reason shown next to the measured values.
- An apply dialog that groups rows by file, pre-selects only real changes and tells which switched-on plugins will be reloaded; the write is confirmed by the user every time.
- A write path with a snapshot before the first change (nothing is written if the snapshot fails), plugin off, re-read, patch, plugin on, read-back with a report of values the plugin corrected, and stop on error without automatic rollback.
- Writable targets in version 1: `plugins/<id>/data.json` of other plugins and `hotkeys.json`; `app.json`, `appearance.json`, `core-plugins.json` and `community-plugins.json` are shown read-only. The plugin's own settings are never written through a profile.
- Secrets are left out of profiles, apply reports, the chat context, saved profile notes and the API: the name must match (`apikey`, `token`, `secret`, `password`, `credential`, `cookie`, `email`, `auth` except `author`) and the value must be non-empty text, an object or a list.
- Snapshots with a two-phase manifest, grandfather-father-son retention (defaults 6 today, 7 days, 4 weeks, 6 months, editable in the settings) and a restore dialog that marks files changed since the apply or without a checksum and leaves them unselected.
- Commands **Undo last apply** and **Open settings chat**, and the snapshot list in the settings tab.
- A settings chat in the sidebar: plugins as chips suggested from the question, a fold-out **Sent context** with plugins, withheld key names, endpoint, model and the full prompt, proposals drawn with the same check rows, **Save as profile note**, a fold-out raw block with secrets redacted under every proposal, and the model's Markdown neutralised before it is rendered.
- Endpoints through the LLM Endpoint Manager when installed, otherwise a local list with connection status; sampling and thinking level through the shared request section; a help row at the top of the settings tab.
- Plugin API v1 (`app.plugins.plugins["settings-assistant"].api`): redacted reading, plan, apply with the plugin's own confirmation dialog, and the tool definitions `read_settings` and `propose_settings`; see `docs/API.md`.
- English and German interface; README in both languages and user documentation after Diátaxis under `docs/`.

### Changed

- The minimum Obsidian version is raised to 1.11.4, because API keys now live in the keychain (also in the local endpoint list without the Endpoint Manager).

### Known issues

- The snapshot list (kit `version-list`) sets `aria-pressed="false"` on its action buttons, although it is not a toggle; a kit task is open (select/action mode), until then it stays as is.
- API keys live in Obsidian's secret storage, also in the local endpoint list without the Endpoint Manager; existing plain-text keys are migrated on first start and removed from `data.json`. This is why the plugin requires Obsidian 1.11.4 or newer; where secret storage is missing, the plain text would stay until the migration.
- JavaScript sorts numeric keys such as `"10"` to the front of an object, so inserting them through a profile can change the key order.
- Chat answers are shown without code formatting: backticks and runs of three or more tildes are replaced by look-alike characters before rendering, so no code block or inline query of another plugin can run on model output. Proposals are shown separately, with the raw block (secrets redacted) in a fold-out.
