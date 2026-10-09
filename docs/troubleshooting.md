# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## Profile is not valid JSON.

**Cause:** the text in the `settings-profile` block cannot be parsed. The plugin deliberately shows only this sentence, not the parser's message, because that message can quote your text and your text may contain a secret.

**Fix:** check for a missing comma or quote, a trailing comma after the last entry, comments (JSON has none) and single quotes instead of double quotes. A JSON-aware editor shows the position.

## Profile must be a JSON object. / Profile has no version. / Profile version is not a valid number.

**Cause:** the block holds JSON, but not the shape a profile needs. A profile is an object (`{ … }`) with `"version": 1`; the version must be a whole number of at least 1.

**Fix:** start from the example in [Profile format](reference-profile-format.md).

## made by a newer version (v2) — update Settings Assistant

**Cause:** the profile's `version` is higher than this plugin knows. Nothing is applied.

**Fix:** update the plugin, or set the version back if you wrote the profile by hand.

## Invalid profile section: plugins.My Plugin

**Cause:** a section is the wrong shape. `plugins`, `hotkeys`, `app` and `appearance` must be objects, every plugin under `plugins` must be an object, and `notes` must be an object. A plugin id may contain letters, digits, `-`, `_` and `.`, must start with a letter or digit, and must not contain `..` or a slash. The name after the colon says where.

**Fix:** correct that section. The names of plugin folders under `plugins/` are the ids.

## unknown section: …

**Cause:** the profile has a top-level section this version does not know, for example a typo such as `hotkey`. It is shown, not applied.

**Fix:** use one of the sections in [Profile format](reference-profile-format.md).

## The apply button is disabled

**Cause:** no row can be applied. Rows that are already set, secret, read-only, blocked, from a missing plugin or from an unreadable file cannot be applied. A row that says **key not found in file** can be, once you tick it in the dialog, and counts as applicable.

**Fix:** read the status text of each row in [Check rows](reference-check-rows.md).

## Another apply run is still in progress.

**Cause:** an apply or a restore is running, started from a note, the chat or another plugin through the API. Only one runs at a time.

**Fix:** wait for its report notice and try again.

## Applying settings failed: …

**Cause:** something unexpected stopped the run before or while writing. The text after the colon is the error's message, never file content.

**Fix:** check the snapshot list under **Settings → Settings Assistant → Snapshots**; if a snapshot of that moment exists, restoring it returns the files. Then try again. If it keeps happening, report it with the message.

## Stopped after an error — remaining entries were skipped.

**Cause:** one file failed to write. The plugin stops instead of rolling back on its own, because a rollback in a half-failed state can cause a second failure. Files before it were written; files after it were skipped.

**Fix:** use **Undo last apply** to restore the files that were written, or fix the cause and apply the remaining rows again.

## changed in the meantime — please review again

**Cause:** between the dialog and the write, the file's value no longer matched what the dialog showed. A plugin that is switched off may save its settings at that moment. That file is not written.

**Fix:** open the note again; the rows are compared afresh. Apply again.

## corrected by the plugin: …

**Cause:** the plugin was reloaded after the write and changed the value, usually because it validates its settings. The row shows what the file holds now.

**Fix:** the value you asked for is not accepted by that plugin. Choose a value it accepts.

## No chat model is set up yet.

**Cause:** the chat found no reachable endpoint.

**Fix:** press **Set up a chat model**, then add your server under **Endpoint** and press **Test connection**. The row status says why a server is not reachable: **Connection refused — server not running or wrong port.**, **Unknown host — typo in the address?**, **Timed out — network unreachable.**, **Answers, but is not an OpenAI-compatible endpoint.** or **Access denied — API key missing or invalid.** Local servers usually need a port, for example `http://127.0.0.1:1234`. For server setup see the [local LLM setup guide](https://uplink.jkaindl.de/llm-setup).

## Error: No endpoint available / Error: timeout / Error: network / Error: http 404

**Cause:** a chat request failed. **No endpoint available — set one up in the plugin settings.** means no endpoint could be resolved; `timeout` and `network` mean the server did not answer; `http <status>` is the server's answer, for example 404 for a wrong address or model name, 401 for a missing key. `overflow` and `truncated` mean the answer did not fit the context or the token budget.

**Fix:** check the endpoint and the model under **Settings → Settings Assistant**, and the details under **Request**. The row **Last request** shows what was sent and **deviation(s) this session** lists what the server did differently.

## Stopped.

You pressed **Stop**. The text that had arrived stays.

## Secret storage is not available in this Obsidian version.

**Cause:** the API key of an endpoint cannot be saved because Obsidian's secret storage is missing. The plugin needs Obsidian 1.11.4 or newer for this.

**Fix:** update Obsidian.

## Nothing to restore from this snapshot.

**Cause:** the snapshot's manifest lists no file that this version may write back, or the manifest is damaged.

**Fix:** pick another snapshot. A snapshot whose manifest cannot be read is skipped in the list, never deleted.

## Getting help

If none of the above fits, open an [issue](https://github.com/johannes-kaindl/settings-assistant/issues) and include the exact message. The settings tab has a **Report an issue** button in the **Help** row. Please never paste a profile or a settings file that contains a secret.
