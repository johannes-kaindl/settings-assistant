# Why secrets never travel

A profile is meant to be copied: into another vault, into a note you sync, into a chat prompt. A settings file is full of things that must not be copied that way — API keys, tokens, passwords, cookies, mail addresses. Settings Assistant therefore keeps them out of every path that leaves the plugin, and shows the omission instead of hiding it.

## What stays out

A secret value is never written by a profile, never put into a profile you save, never sent to the language model and never returned through the plugin API. Where a secret sits, the check rows show a row of its own, **secret — never transferred via profiles. Set it in the plugin's settings.**, with the plugin and the key, no value, and an **Open settings** button to the plugin's settings tab. In the chat, a secret appears in the context as `🔒`, and the fold-out **Sent context** lists the **Withheld keys (names only)**. **Save as profile note** writes `🔒` for a withheld value.

## The rule

A value is a secret when its name matches **and** the value is non-empty text, an object or a list.

**The name** is checked as a part of the lowercased key name. It matches when it contains any of: `apikey`, `api_key`, `api-key`, `token`, `secret`, `password`, `credential`, `cookie`, `email`. It also matches when it contains `auth`, with one exception: `auth` followed by `or` does not count, unless the letters `iz` follow, so `author`, `authorUrl` and `authors` stay free while `authorization`, `authorize` and `oauth` are secret.

**The value** decides whether the name is enough. Non-empty text is a secret. An object or a list is a secret as a whole subtree: a key such as `hostSecrets` or `syncTokens` that holds an object hides everything below it, because the secrets inside sit under harmless names such as a host name. Numbers, true/false, `null` and empty text are never secret.

A path is secret if any key on the way to it is a secret value.

## Why name and value together

Matching the name alone is what comparable tools do, and it is too coarse. Measured over 75 `data.json` files in two vaults, a bare substring match on names hit around ten harmless number fields, among them `contextWindowTokens`, `maxTokens` and `maxOutputTokens`: `Tokens` contains `token`, but the value is a count. Those would have made a legitimate change, such as setting `contextWindowTokens` to `128000`, impossible. With the value condition they drop out.

| Key | Value | Secret? | Why |
|---|---|---|---|
| `apiKey` | `"sk-…"` | yes | name matches, non-empty text |
| `apiKey` | `""` | no | empty text; nothing to protect |
| `contextWindowTokens` | `128000` | no | a number is never secret |
| `migrateProviderApiKeysToSecretStorage` | `true` | no | the name matches, the value is a boolean |
| `headers.authorization` | `"Bearer …"` | yes | `authorization` matches `auth` + `iz` |
| `authorUrl` | `"https://…"` | no | `author` is the exception |
| `hostSecrets` | `{ "host": "…" }` | yes | name matches, an object hides its whole subtree |
| `secretId` | `"abc"` | yes | a harmless-looking text under a suspicious name is hidden on purpose: better too much |

## Endpoint keys

The API keys of this plugin's own endpoint list are not kept in `data.json`. They are stored in Obsidian's secret storage, and `data.json` holds only a reference. That is why the plugin needs Obsidian 1.11.4 or newer. An older plaintext key is moved there at the first start and removed from the file.

## Where the rule stops

Be clear about what this does not do.

- **A secret under a harmless name is not recognised.** If a plugin stores a token under a key called `value` or `host`, the rule cannot know. The name is all it sees.
- **Name/value pairs are not recognised.** In `{ "name": "token", "value": "abc123" }` the key `value` is harmless and `abc123` is harmless text; the word `token` is a value, not a key.
- **A secret inside text is not recognised.** A password inside a URL (`https://user:pw@host`) or a JSON document stored as a string is just text.
- **A secret that is a number is not recognised**, for example a numeric PIN under `pin`.
- **Snapshots are copies.** A snapshot saves the affected file as it is, secrets included, in the plugin's folder in your configuration folder — the same place those secrets already live, in a copy, and never shown or sent anywhere. Keep that in mind if you sync or publish the configuration folder.

## Related

- The error text for invalid JSON never repeats what the parser says, because the parser can quote your text, and your text can contain a secret. Only a fixed sentence is shown.
- Setting values go to the model as text. A value can contain an instruction aimed at the model. That is why the model's answer is only ever parsed as a proposal, why every proposal passes through the check rows and a confirmation dialog, and why the answer's Markdown is neutralised before it is displayed: images, embeds and HTML would otherwise load content on their own.
