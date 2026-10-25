# Known limits

## Version 1 scope

- **Writable:** `plugins/<id>/data.json` of other plugins, and `hotkeys.json`. Nothing else.
- **Read, not written:** `app.json`, `appearance.json`, `core-plugins.json` and `community-plugins.json`. A profile may name them; the rows read **read-only in this version** and nothing is silently dropped.
- **Not planned in the plugin:** appearance and CSS (themes and snippets).
- **Never written:** the plugin's own `data.json`, because reloading itself in the middle of an apply would close its own interface. The plugin never switches itself off or on.
- **Secrets are not transferred.** See [Why secrets never travel](explanation-secrets.md) for the rule and for what it cannot see.

## The chat

- The chat history lives in memory only. To keep a proposal, use **Save as profile note**.
- The model knows a key only by its name. The rows catch invented keys, not misunderstood ones. The plugin's documentation is not part of the context.
- The chat needs a reachable endpoint. It is built to run on mobile. It was measured in Obsidian's mobile emulation on the desktop: the controls stay reachable with a long history on a 390 × 844 and a 320 × 568 screen, the plugin loads without console errors, and the key comes from the secret storage. It has not been measured on a device: the on-screen keyboard, touch scrolling, the network path to an endpoint on your local network and the secret storage on the phone are still open.

## Applying

- Only one apply or restore runs at a time, including calls through the API.
- A plugin that is switched on is switched off, written and switched on again, so its open views close. A plugin that is switched off is only written.
- On an error the run stops; it does not roll back on its own.
- Number-like keys such as `"10"` are sorted to the front of an object by JavaScript when they are inserted into a file. Obsidian's own settings do not have such keys today.

## Snapshots

- The snapshot list in the settings (a vendored list component) marks its entries `aria-pressed="false"` although they act as buttons. A fix is tracked in the shared component library; until then it stays so.
- The snapshot copies the file as it is, secrets included (see [Why secrets never travel](explanation-secrets.md#where-the-rule-stops)).

## Endpoint keys

API keys, also those of the local endpoint list used without the LLM Endpoint Manager, are kept in Obsidian's secret storage. Existing plaintext keys are moved there at the first start and removed from `data.json`. The plugin therefore needs Obsidian 1.11.4 or newer; where secret storage is missing, a plaintext key would remain until it can be migrated.
