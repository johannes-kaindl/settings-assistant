# Ask the chat

The settings chat lets a local model draft a profile from a question. The model sees the settings of the plugins you name, with secrets replaced by `🔒`, and answers in plain language plus, when a change is needed, one `settings-profile` block. The chat never writes anything by itself: a proposal goes through the same rows and the same confirmation dialog as a profile in a note.

## Before the first question

The chat needs an endpoint with a chat model. Under **Settings → Settings Assistant**, either install the LLM Endpoint Manager (the endpoints come from it) or fill the local list: add the address of your server, for example the one of LM Studio, choose its model in the row, and press **Test connection**. A row that reads **Connected** is usable. If you have no server yet, follow the [local LLM setup guide](https://jkaindl.de/uplink/llm-setup/). Without an endpoint the chat shows **No chat model is set up yet.** with a button **Set up a chat model**.

## Ask

1. Run **Open settings chat**, or use the ribbon icon. The chat opens in the right sidebar; on a phone it opens as a tab in the main area, where the on-screen keyboard leaves more room than in the drawer.
2. Type your question and send with **Send** or Enter; Shift+Enter starts a new line. Name the plugin in the question, for example "Why does my-plugin stop after twenty rounds?". Plugins whose id or name appears in your message are picked as chips above the input.
3. Correct the chips before you send: remove one with its **x**, add one with the **Add a plugin…** dropdown. Only these plugins' settings go with the question. A list of all installed plugins (id and name) always goes along.
4. **Stop** (the Send button turns into Stop while an answer runs) or Escape cancels a running answer. **New chat**, the pen-and-square icon left of Send (or the command **Start new chat**), starts an empty conversation: with the history on it files the old one first and says so, without asking; with **Chats to keep** at 0 it asks before it discards. It is locked while the conversation is empty and while an answer runs.

## Choose the model

One row above the input shows which model answers and switches it: a dropdown with the models of the active endpoint, **Automatic** (the endpoint decides), the thinking level and a reload button. It is the same choice as the model in the endpoint's row under **Settings → Settings Assistant**. A model you chose that the endpoint no longer lists stays selected, with a warning icon. The row is locked while an answer runs.

The thinking level is a dropdown with the levels of the chosen model: for Claude low up to max as far as the model has them, for local models off, low, medium, high (a model the plugin does not recognise shows the same four on LM Studio and Open WebUI). **Very high** and **max** make answers long and expensive, and the dropdown says so. A stored **off** on a Claude model sends the model's own default instead, because Claude cannot be fully switched off here. The meaning of the levels is in the settings under **Request**.

## Past chats

With **Chats to keep** above 0 (the default is 50), the plugin files every conversation as a `.json` file in the folder you set under **Settings → Settings Assistant → Past chats** (empty means `Settings Assistant/Chats`). The history button (clock icon) next to **New chat**, or the command **Open past chats…**, opens the list: type to search the titles, press Enter or click a row to continue that chat (it writes back into its own file), **Save as note** (also Shift+Enter) writes a Markdown copy beside it that the plugin never reads again, and **Delete** (also Alt+Enter) asks first and is final. Lowering **Chats to keep** deletes the oldest chats above the number at the next save. The files contain the **Sent context** too; read [Why secrets never travel](explanation-secrets.md#where-the-rule-stops) before you sync the folder.

## Read what was sent

Under each of your questions a fold-out **Sent context** shows the plugins, the **Withheld keys (names only)**, files that could not be read, the endpoint, the model and the **Full prompt**. This is the text that left your machine, to the endpoint you configured. If that endpoint is a hosted provider, the settings of the chosen plugins went there, minus secrets.

## Read the answer

The answer streams in. The model's own reasoning, if the endpoint sends it, is open while it arrives and folds shut under **Thoughts** when the answer is done; a button next to it copies the thinking. A status line under the input says what the model is doing (thinking, writing, done) and, next to it, how long the answer took. Question and answer each have a copy button.

If the request fails, a red line under the answer says why; with an HTTP error it ends with the server's own reason, and with a network error it adds the technical message in brackets (keys and tokens masked). **Send again** under the last failed answer asks the same question again. A failed or stopped round is not sent to the model with your next question. Because the answer comes from a model, it is treated as untrusted text: images and embeds are not loaded, they appear as plain text or code, and HTML is shown escaped. Links stay and need a click.

A `settings-profile` block in the answer is drawn like a profile note: check rows, the model's reasons as `Reason: …`, and an apply button. The model knows a key only by its name, so it can invent keys (shown as **key not found in file**) and misjudge what a key does. The rows catch the first; you are the check for the second.

## Apply or keep

- Apply with the button under the rows. The dialog, the snapshot and the report are the same as for a note. The snapshot's origin reads `chat:<time>/<model>`.
- **Save as profile note** keeps the proposal as a note for another vault (see [Align two vaults](howto-align-two-vaults.md)). Withheld values are named in a line under the button.

If something goes wrong, [Troubleshooting](troubleshooting.md) lists the messages.
