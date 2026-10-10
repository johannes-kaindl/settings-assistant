# Getting started: First profile

This walk-through takes you from a fresh install to one setting changed through a profile, and back again. It needs about ten minutes, one other plugin whose settings you can change safely, and no language model.

## 1. Install and enable the plugin

Follow the [manual install in the README](https://github.com/johannes-kaindl/settings-assistant/blob/main/README.md#install), then enable **Settings Assistant** under **Settings → Community plugins**. The plugin needs Obsidian 1.11.4 or newer.

Open **Settings → Settings Assistant**. The first row is **Help**; below it you will find the endpoint (each row with its model), **Request** and **Snapshots**. You do not need to set any of them for a profile in a note.

## 2. Pick a setting to change

Choose another plugin and one setting you know the key of. Settings live in `<vault>/.obsidian/plugins/<plugin-id>/data.json`, and the key is the name that stands in that file. For this tutorial the value should be harmless, such as a number of items or a true/false switch. Avoid anything that looks like a key or a password; those are left out on purpose (see [Why secrets never travel](explanation-secrets.md)).

The plugin id is the folder name under `plugins/`. In the example below the plugin id is `my-plugin` and the key is `maxRounds`; replace both with your own.

## 3. Write the profile

Create a note and add a fenced code block whose language is `settings-profile`:

````markdown
```settings-profile
{
  "version": 1,
  "plugins": {
    "my-plugin": { "maxRounds": 20 }
  },
  "notes": {
    "plugins.my-plugin.maxRounds": "A shorter run while I try this out."
  }
}
```
````

Switch the note to reading view. The block turns into a box titled **Settings profile**. Keep the value's type: `20` is a number and stays one, `"20"` would be text.

## 4. Read the check rows

Each key is one row with a path, a status text and, where it applies, the current and the wanted value as `current → wanted`. The sentence from `notes` appears under it as `Reason: …`.

- **will change** — the value in the file differs from the profile. The row is ready to be applied.
- **already set** — the file already has this value. Nothing to do.
- **key not found in file** — the key does not exist in the plugin's file. This is how an invented or misspelled key shows up. You may still apply it, but it is not pre-selected.
- **plugin not installed** — there is no plugin with that id.

All statuses are listed in [Check rows](reference-check-rows.md). If your row says anything other than **will change**, fix the profile first.

## 5. Apply it

Press the button under the rows, **Apply 1 change**. A dialog titled **Apply settings** lists the rows, grouped by file, with a checkbox on each row that can be applied. If the plugin is switched on, a line such as `my-plugin will be reloaded — open views close.` tells you so. That is how the file is written safely: the plugin is switched off, the file is written, the plugin is switched on again.

Press **Apply 1 change** in the dialog. A notice reports the result row by row, for example `plugins.my-plugin.maxRounds — written`, and names the snapshot that was saved first. Open the plugin's own settings: the new value is there.

If the plugin changed the value on loading, the row says **corrected by the plugin: …** and shows what the file holds now. That is reported on purpose instead of calling it written.

## 6. Take it back

Run the command **Undo last apply** from the command palette. The dialog **Restore snapshot** lists the files of the snapshot. The row of your file says **unchanged since the apply — will be restored** and is ticked. Confirm with **Restore 1 file**.

If the plugin saved the file again in the meantime, the row says **changed since — not selected. Tick to overwrite anyway.** That is the check that keeps a restore from silently undoing later changes. How it decides is explained in [Snapshots and retention](explanation-snapshots.md).

## Where to go next

- Carry the same profile to another vault: [Align two vaults](howto-align-two-vaults.md).
- Let a local model draft the profile for you: [Ask the chat](howto-ask-the-chat.md).
- Every section a profile may hold: [Profile format](reference-profile-format.md).
