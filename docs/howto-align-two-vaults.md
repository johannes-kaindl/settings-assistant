# Align two vaults

A plugin cannot read another vault through Obsidian's API. Aligning two vaults therefore goes through a profile note: you create it in vault A, move it to vault B with whatever you already use (sync, copy), and apply it there.

## Create the profile in vault A

1. Write a `settings-profile` block with the plugins and keys you want to share (see [Profile format](reference-profile-format.md)). For values you do not remember, open the chat, name the plugin and ask; the answer comes with a profile block (see [Ask the chat](howto-ask-the-chat.md)).
2. Use **Save as profile note** under a chat answer to keep a proposed profile as a note. The note is named `Settings profile YYYY-MM-DD HH-mm` and is created in the folder of the note you had open, or in the vault root.
3. Look at the note before you move it. Values that were withheld as secrets are written as `🔒`, and notes belonging to a plugin with withheld values are dropped from the saved profile. A line under the button names what was withheld.

## Apply it in vault B

1. Get the note into vault B, with sync or by copying the file.
2. Open it in reading view. The block compares the profile with the files of vault B, not with vault A.
3. Read the rows. **plugin not installed** means vault B lacks that plugin. **already set** rows need nothing. **will change** rows are ticked.
4. Press the apply button, check the dialog, confirm. A snapshot is saved before anything is written, so vault B can be taken back.

## Things to know

- Secrets are never part of a profile. A row marked **secret — never transferred via profiles. Set it in the plugin's settings.** stays for you to set by hand in vault B, with an **Open settings** button to the plugin. See [Why secrets never travel](explanation-secrets.md).
- Lists are replaced as a whole, never merged. If vault B has an extra list entry, the profile removes it. See [Profile format](reference-profile-format.md#merging).
- A profile written by a newer version of the plugin is refused with `made by a newer version (vN) — update Settings Assistant`. Update vault B's plugin first.
