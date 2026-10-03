# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
