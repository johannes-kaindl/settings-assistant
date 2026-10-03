# Snapshots and retention

A write to a settings file is hard to see and easy to regret. So before the plugin changes anything, it saves the files it is about to change. This page explains what is saved, how long it stays, and how taking a change back decides what it may touch.

## What is saved

Before each apply, the files that the ticked rows touch are copied to `<configDir>/plugins/settings-assistant/snapshots/<time>/files/`, with a `manifest.json` next to them. The folder is named after the time of the apply, for example `2026-10-03T16-25-00`; if that name is taken, a suffix is added.

The manifest holds:

- `at` — the time of the apply.
- `origin` — where the profile came from: `note:<path>` for a profile note, `chat:<time>/<model>` for the chat, `api:<caller>` for another plugin, `restore:<folder>` for a restore.
- `files` — for each file its path, whether it existed before (an apply may create a `data.json`; taking that back then means deleting it) and a checksum of what the apply wrote.

The manifest is written in two phases. First it is saved with no checksums, before the first change. After the writes it is updated with the checksum of each file as written. **If the snapshot cannot be saved, nothing is written.** If a run stops after an error, the manifest still records the state of each file.

## Take it back

Two ways in:

- The command **Undo last apply** takes the newest snapshot that is not itself a restore.
- The list under **Settings → Settings Assistant → Snapshots → Saved snapshots**, newest first, each with date, origin and number of files. Selecting one opens the same dialog.

The dialog **Restore snapshot** shows one row per file and decides each by comparing the file's present checksum with the one stored at the apply:

| Row text | Meaning | Ticked |
|---|---|---|
| unchanged since the apply — will be restored | The file is exactly as the apply left it. | yes |
| changed since — not selected. Tick to overwrite anyway. | Someone, possibly the plugin itself, changed the file after the apply. | no |
| unverified, no checksum stored — not selected. Tick to restore anyway. | The apply stopped before a checksum was stored. | no |

Ticking a changed file is a deliberate overwrite. The confirm button reads **Restore N file(s)**. A file that did not exist before the apply is deleted. Plugins that are switched on are switched off, restored and switched on again, like an apply.

A restore saves a snapshot of its own first, the **Safety snapshot** (origin `restore:<folder>`), so a restore can be taken back too.

An error never triggers an automatic rollback: a rollback from a half-failed state can fail a second time. The report stops, names the snapshot, and the decision stays with you.

## Retention

Snapshots would pile up, but a handful from today and one from each earlier period is usually enough. The plugin keeps them like grandfather-father-son backups. A snapshot is the state *before* a write, so the oldest snapshot of a period is the state before that period began.

The settings under **Snapshots → Retention** are:

| Setting | Meaning | Default |
|---|---|---|
| Keep from today | The newest N snapshots of the current day. | 6 |
| Keep per day | For the last N days including today, the oldest of each day. | 7 |
| Keep per week | For the last N ISO weeks (Monday start) including the current one, the oldest of each week. | 4 |
| Keep per month | For the last N calendar months including the current one, the oldest of each month. | 6 |

0 keeps none for that period. The windows overlap, so at most 23 snapshots survive with the defaults and fewer in practice. Days, weeks and months follow the calendar of your computer's time zone, including daylight-saving changes. The defaults are starting values, not a measurement.

Pruning runs after a successful apply or restore, after the new snapshot is saved. It deletes only what is outside every window. A snapshot dated in the future (a clock error) is always kept, and a snapshot whose manifest cannot be read is skipped and never deleted. If pruning itself fails, the report is not lost.

An entry in the retention fields must be a whole number of at least 0; anything else falls back to the default for that field.
