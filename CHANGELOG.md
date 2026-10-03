# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Profiles as notes: a fenced `settings-profile` block (JSON, `version: 1`) shows a live comparison with the current files in reading view and an apply button.
- Check rows for every key (will change, already set, key not found in file, plugin not installed, file is not valid JSON, path blocked by a non-object value, secret, read-only in this version), with the profile's reason shown next to the measured values.
- An apply dialog that groups rows by file, pre-selects only real changes and tells which switched-on plugins will be reloaded; the write is confirmed by the user every time.
- A write path with a snapshot before the first change (nothing is written if the snapshot fails), plugin off, re-read, patch, plugin on, read-back with a report of values the plugin corrected, and stop on error without automatic rollback.
- Writable targets in version 1: `plugins/<id>/data.json` of other plugins and `hotkeys.json`; `app.json`, `appearance.json`, `core-plugins.json` and `community-plugins.json` are shown read-only. The plugin's own settings are never written through a profile.
- Secrets are left out of profiles, apply reports, the chat context, saved profile notes and the API: the name must match (`apikey`, `token`, `secret`, `password`, `credential`, `cookie`, `email`, `auth` except `author`) and the value must be non-empty text, an object or a list.
- Snapshots with a two-phase manifest, grandfather-father-son retention (defaults 6 today, 7 days, 4 weeks, 6 months, editable in the settings) and a restore dialog that marks files changed since the apply or without a checksum and leaves them unselected.
- Commands **Undo last apply** and **Open settings chat**, and the snapshot list in the settings tab.
- A settings chat in the sidebar: plugins as chips suggested from the question, a fold-out **Sent context** with plugins, withheld key names, endpoint, model and the full prompt, proposals drawn with the same check rows, **Save as profile note**, and the model's Markdown neutralised before it is rendered.
- Endpoints through the LLM Endpoint Manager when installed, otherwise a local list with connection status; sampling and thinking level through the shared request section; a help row at the top of the settings tab.
- Plugin API v1 (`app.plugins.plugins["settings-assistant"].api`): redacted reading, plan, apply with the plugin's own confirmation dialog, and the tool definitions `read_settings` and `propose_settings`; see `docs/API.md`.
- English and German interface; README in both languages and user documentation after Diátaxis under `docs/`.

### Changed

- The minimum Obsidian version is raised to 1.11.4, because API keys now live in the keychain (also in the local endpoint list without the Endpoint Manager).

### Known issues

- Die Schnappschuss-Liste (Kit-`version-list`) setzt `aria-pressed="false"` auf Aktionsknöpfe, obwohl sie semantisch ein Toggle ist; Kit-Task angelegt (Modus select/action), bis dahin bleibt es so.
- API-Schlüssel liegen im Schlüsselbund, auch in der lokalen Endpunkt-Liste ohne Endpoint Manager; vorhandene Klartext-Schlüssel werden beim ersten Start migriert und aus der data.json entfernt. Das Plugin verlangt dafür Obsidian 1.11.4 oder neuer; wo der Schlüsselbund fehlt, bliebe der Klartext bis zur Migration stehen.
- Zahlenschlüssel wie `"10"` sortiert JavaScript in Objekten nach vorn (Profil-Einsetzen).
