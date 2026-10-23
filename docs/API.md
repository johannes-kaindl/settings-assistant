# Plugin API v1

`settings-assistant` (change settings by profile or chat, with a diff, a snapshot and without secrets) offers other Obsidian plugins a narrow, versioned API: redacted reading of settings, a plan (never writes), a write path with its own confirmation dialog, and two tool definitions for foreign agent loops.

Implementation: `src/obsidian/api.ts` (`createSettingsAssistantApi`). The pattern is `calendar-notes/docs/API.md`; the difference is in rule 5.

## Access

```ts
const sa = app.plugins.plugins["settings-assistant"]?.api;
if (sa?.apiVersion === 1) {
  const r = await sa.readSettings({ plugin: "calendar-notes" });
}
```

## Consumer rules (binding for every caller)

1. **Look it up fresh on every call, never cache it at load time.** `settings-assistant` can be disabled at runtime, and access through `app.plugins.plugins[...]` is only an object lookup.
2. **Check `apiVersion` before relying on the shape.** The number increases with every breaking change; a consumer that sees a different version treats the API as absent instead of guessing.
3. **Copy the types instead of importing them, with a provenance stamp.** Both plugins are independent store repos without a build coupling; the version number replaces the compiler.
4. **Check for `{ error }`, never hope for a throw.** Every method except the synchronous `status()` and `tools()` catches internally and returns `{ error: string }`; `error` is a raw, untranslated diagnostic word, never a text containing file content.
5. **When writing, the API ALWAYS opens its own dialog — `confirms: "provider"`.** This is the deliberate reversal of the `calendar-notes` pattern: a public `.api` onto `.obsidian` must not be a silent write access. A host skips its own confirmation for such tools but still shows the plan. There is no parameter that bypasses the confirmation.

## Methods

```ts
apiVersion: 1
version: 1                                     // the library's tool-provider contract, see "Tool contract of the library"
status(): { busy: boolean; writable: string[]; stage: "v1" }
readSettings(q: { plugin: string } | { file: ObsidianFile }): Promise<{ settings: Json | null; redacted: string[] } | ApiError>
planProfile(profile: unknown): Promise<{ rows: ApiCheckRow[] } | ApiError>
applyProfile(profile: unknown, opts: { origin: string }): Promise<{ results: Array<{ path: string; outcome: RowOutcome; actual?: Json }>; snapshot: string | null } | { cancelled: true } | { busy: true } | ApiError>
tools(opts?: { lang?: "de" | "en" }): ApiToolDefinition[]
execute(name: string, args: unknown): Promise<unknown>
executeTool(name: string, args: Record<string, unknown>, opts?: { lang?: "de" | "en"; confirm?: (preview) => Promise<boolean> }): Promise<ProviderResult>
```

- `status()` is synchronous and network-free. `writable` names the writable targets as text: `plugins/*/data.json` and the released Obsidian files (in stage 1 only `hotkeys`). `busy` is `true` while a write or restore operation is running.
- `readSettings` reads an installed plugin (`{ plugin }`) or an Obsidian file (`{ file }`: `app`, `appearance`, `hotkeys`, `core-plugins`, `community-plugins`). Exactly one of the two keys must be given. The result is ALWAYS redacted: secret values appear as `🔒`, and `redacted` lists their paths. If the file does not exist, `settings` is `null`. The settings of `settings-assistant` itself are not returned.
- `planProfile` writes nothing. `profile` is an object or JSON text in the profile format (`version: 1`, `plugins`, Obsidian files, `notes`). `ApiCheckRow` carries `target` (e.g. `plugins.foo`), `path` (dotted path), `status` and, where present, `current`, `desired`, `note`. A row with status `secret` carries only `target`, `path` and `status`. Rows for Settings Assistant's own settings (`plugins.settings-assistant`) carry only `target`, `path` and status `read-only`, because the API never reads them.
- `applyProfile` shows the diff and the selection in its own dialog and writes only after the human confirms, with a snapshot taken before writing. `origin` names the caller and is stored as `api:<origin>` in the snapshot manifest (at most 80 characters, no control or line-break characters, not empty; otherwise `api:unknown`). `snapshot` is the snapshot folder or `null`.
- `{ cancelled: true }` means the human dismissed the dialog and nothing was written. `{ busy: true }` means another operation is running; try again later.

## Tools

| Name | writes | confirms | Parameters |
|---|---|---|---|
| `read_settings` | `false` | `caller` | `{ plugin?: string; file?: string }` (exactly one of the two) |
| `propose_settings` | `true` | `provider` | `{ profile: object }` |

`execute(name, args)` validates the arguments. `propose_settings` calls `applyProfile` with the origin name `propose_settings` and thereby opens the plugin's own dialog.

## Tool contract of the library (`version: 1`, `executeTool`)

Next to its own contract the plugin offers the library's tool-provider contract (obsidian-kit `tool-provider`), so that hosts with an agent loop (Koda) mount the two tools without a special case. The own API stays unchanged (`apiVersion` 1, `execute`). `tools()` serves both: `name`, `description`, `parameters` and `writes` are the library's fields; `confirms` is the plugin's own and does not go to the wire.

- `executeTool(name, args, { lang, confirm })` takes one step and returns a value, never a throw: `{ ok: true, content, data? }` or `{ ok: false, reason, message }` with `reason` one of `unknown-tool`, `bad-args` (with `field`), `failed`, `needs-confirm`, `unavailable` (with `detail`).
- `read_settings` returns the redacted settings as JSON text in `content` and as an object in `data`. The error words above map to `bad-args` (arguments) or `failed` (`own-settings`, `not-installed`, `unreadable`).
- `propose_settings` writes only after TWO confirmations. First the host's: the plugin calls `confirm` once with a preview (`summary` and `paths`, the full set of vault paths the call can touch: the target files and the snapshot folder; no values), and without `confirm`, or when it answers `false` or throws, the result is `needs-confirm` and nothing is written. Then the plugin's own diff dialog opens, exactly as for `applyProfile`; if the human dismisses it, the result is `needs-confirm` as well. The host's confirmation never replaces the dialog.
- If the profile changes nothing, the result is `ok` without a `confirm` call and without a dialog. While another operation runs, the result is `unavailable` with `detail: "busy"`.

## Error words

- `bad-args`: arguments are missing or have the wrong shape, or a plugin ID is invalid.
- `own-settings`: `readSettings` for `settings-assistant` itself.
- `not-installed`: the plugin is not installed.
- `unreadable`: the file is not valid JSON.
- `unknown-tool`: `execute` does not know the name.
- `failed`: unexpected error in the plugin or while writing; the text stays inside the plugin.
- `invalid-profile`: the profile cannot be serialized as JSON.
- Profile errors, each the parser's word: `invalid-json`, `not-object`, `missing-version`, `bad-version`, `future-version`, `bad-section`.

## Example: a host with an agent loop (tool contract of the library)

```ts
import { callProviderTool, isToolProviderApi } from "./vendor/kit/tool-provider";   // the library's module, vendored
const api = app.plugins.plugins["settings-assistant"]?.api;
if (!isToolProviderApi(api)) return;
const tools = api.tools({ lang: "en" });      // into the agent loop's tool registry
// … the model picks propose_settings and supplies a profile …
const r = await callProviderTool(api, "propose_settings", { profile }, { lang: "en", confirm: async (preview) => askTheUser(preview) });
// The host confirms the preview; Settings Assistant then shows its own diff dialog before anything is written.
if (!r.ok && r.reason === "needs-confirm") { /* declined by the host or the human; nothing was written */ }
```

The plugin's own contract still works for consumers that were written against it: `sa.apiVersion === 1`, `sa.execute("propose_settings", { profile })` opens the dialog without a host confirmation.
