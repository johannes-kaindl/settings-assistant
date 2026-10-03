# Profile format

A profile is JSON, in the same notation as the files it targets, so types stay exact: `128000` stays a number, `"on"` stays text. It lives in a fenced code block with the language `settings-profile` in any note, or it is produced by the chat or handed over through the [API](API.md).

````markdown
```settings-profile
{
  "version": 1,
  "plugins": {
    "my-plugin": { "maxRounds": 20, "contextWindowTokens": 128000 }
  },
  "hotkeys": {
    "editor:toggle-bold": [{ "modifiers": ["Mod"], "key": "B" }]
  },
  "notes": {
    "plugins.my-plugin.maxRounds": "Shorter runs on the work machine."
  }
}
```
````

## Sections

The top level is an object. These keys are known; every other key is an [unknown section](#unknown-sections).

| Section | Targets | Shape | In this version |
|---|---|---|---|
| `version` | — | whole number, at least 1 | required; the only known value is `1` |
| `plugins` | `<configDir>/plugins/<id>/data.json` | object: plugin id → object of values | writable |
| `hotkeys` | `<configDir>/hotkeys.json` | object: command id → list of bindings | writable |
| `app` | `<configDir>/app.json` | object | read-only |
| `appearance` | `<configDir>/appearance.json` | object | read-only |
| `core-plugins` | `<configDir>/core-plugins.json` | any JSON value | read-only |
| `community-plugins` | `<configDir>/community-plugins.json` | any JSON value | read-only |
| `notes` | — | object: path → one sentence | optional |

`<configDir>` is the vault's configuration folder, usually `.obsidian`; the plugin reads it from the vault and never hard-codes the name.

"Read-only" means a row for it is shown with the text **read-only in this version** and is never written; the section is not ignored. The same text appears for the plugin's own settings (`plugins.settings-assistant`), which are never written through a profile.

A plugin id may contain letters, digits, `-`, `_` and `.`, must start with a letter or digit, and must not contain `..`. Anything else is refused with **Invalid profile section: plugins.<id>**.

## Version

`version` is required. It must be a whole number of at least 1.

- Missing: **Profile has no version.**
- Not a whole number, or below 1: **Profile version is not a valid number.**
- Higher than the plugin knows: **made by a newer version (vN) — update Settings Assistant**. Nothing is applied and nothing is half-read; a document from a newer version is refused as a whole.

## Merging

How a profile and a file are combined is decided key by key.

- Nested objects are walked down to their leaves: only the leaves you name are compared and written, every other key of the file stays.
- Lists are leaves. A list in the profile replaces the list in the file as a whole, never merged element by element.
- An empty object `{}` is a leaf too: it replaces the value.
- A leaf that does not exist in the file is added at the end of its object. If the file does not exist at all, it is created.
- If a value on the way to a leaf is not an object (the file holds a number where your path needs an object), the row is **path blocked by a non-object value** and is not written.
- Unknown keys, the order of keys, the indentation and a trailing newline of the file are kept.

The keys `__proto__`, `constructor` and `prototype` are refused as path segments.

## Notes

`notes` is optional. Each entry maps a path to one sentence saying why, for the row that has that path:

- `plugins.<plugin-id>.<key>` for a plugin, with nested keys joined by dots (`plugins.my-plugin.ui.compact`).
- `<section>.<key>` for a file such as `hotkeys`.

The sentence is shown under the row as **Reason: …**. It is the claim; the row's status and values are the plugin's own measurement, shown separately. Non-text values in `notes` are ignored. The chat fills `notes`; a human may too. Notes on secret rows are never shown.

## Unknown sections

A top-level key that is none of the above is listed under the rows as **unknown section: <name>** and is not applied. A typo therefore stays visible instead of being silently dropped.

## Errors

| Text | Cause |
|---|---|
| Profile is not valid JSON. | The text cannot be parsed. |
| Profile must be a JSON object. | The top level is a list, text, number or `null`. |
| Profile has no version. | `version` is missing. |
| Profile version is not a valid number. | `version` is not a whole number of at least 1. |
| made by a newer version (vN) — update Settings Assistant | `version` is above 1. |
| Invalid profile section: <name> | `plugins`, `hotkeys`, `app`, `appearance` or `notes` is not an object, a plugin's values are not an object, or a plugin id is invalid. |

Only these sentences are shown. The parser's own message for invalid JSON is never displayed, saved or returned by the API: it can quote the text, and the text can hold a secret.

## Secrets in a profile

A secret value in a profile is not written and not transferred; the row is **secret — never transferred via profiles. Set it in the plugin's settings.** See [Why secrets never travel](explanation-secrets.md).
