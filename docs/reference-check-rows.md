# Check rows

Before anything is written, the profile is compared with the files. Each leaf value of the profile becomes one row. The same rows appear in a profile note, in the chat and in the apply dialog.

A row shows a symbol (never alone), the path, the status text, and, where it applies, the values as `current → wanted` (long values are cut at 120 characters; `—` stands for a missing side). The profile's sentence for the path appears as **Reason: …**.

## Statuses

The plugin tests a row in this order and takes the first that applies.

| Status | Text shown | Symbol | Ticked | Can be applied | When |
|---|---|---|---|---|---|
| `secret` | secret — never transferred via profiles. Set it in the plugin's settings. | 🔒 | no | no | The path runs through a secret name with a secret value in the file or in the profile, or the value contains one deeper down. No values are shown. Plugin targets get an **Open settings** button. |
| `not-installed` | plugin not installed | ⚠ | no | no | The target is a plugin and no plugin with that id is installed. |
| `unreadable` | file is not valid JSON | ⚠ | no | no | The target file exists but is not valid JSON. It is not touched. |
| `read-only` | read-only in this version | 👁 | no | no | The target is not writable: `app`, `appearance`, `core-plugins`, `community-plugins`, or the plugin's own settings. The current and wanted values are shown. |
| `shape-conflict` | path blocked by a non-object value | ⚠ | no | no | A value on the way to the leaf exists and is not an object. |
| `missing-key` | key not found in file | + | no | yes, after ticking | The key does not exist in the file, or the file does not exist yet. This is how invented keys show up. |
| `same` | already set | ✓ | no | no | The value in the file equals the profile's (compared deeply). |
| `change` | will change | → | yes | yes | The key exists and differs. |

In the apply dialog the rows are grouped by file under the target's name (for example `plugins.my-plugin`). A group of a plugin that is switched on carries `<id> will be reloaded — open views close.` The button reads **Apply N change(s)** with the number of ticked rows and is disabled at zero. In a profile note the button counts all rows that can be applied, including unticked `missing-key` rows, and the dialog then has the last word.

The rows show a symbol and a text; the colour of a row is never the only signal. Checkboxes carry the label **Apply <path>**.

A profile with no entries shows **No entries to check.**

## Outcomes after an apply

After the write each row gets an outcome in the report notice. The file is read back after the plugin is switched on again.

| Outcome text | Meaning |
|---|---|
| written | The file holds the wanted value. |
| corrected by the plugin: <value> | The file holds a different value than asked; the plugin changed it while loading. The value it holds is shown. |
| skipped | An earlier file failed; this one was not touched. |
| changed in the meantime — please review again | The current value no longer matched the dialog; the file was not written. |
| error: <message> | Writing this file failed. The run stops here. |

A `secret` row appears in a report only as its status text. The report ends with **Stopped after an error — remaining entries were skipped.** if the run stopped, and with **Snapshot: <folder>**.

## Outcomes after a restore

| Outcome text | Meaning |
|---|---|
| restored | The file was written back (or deleted, if it did not exist before the apply). |
| changed since — left as is | The file changed after the apply and was not ticked. |
| unverified — left as is | The snapshot holds no checksum for the file and it was not ticked. |
| error: <message> | Restoring this file failed. |

The restore dialog rows are described in [Snapshots and retention](explanation-snapshots.md).
