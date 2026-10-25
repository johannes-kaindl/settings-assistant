# Ask the chat

The settings chat lets a local model draft a profile from a question. The model sees the settings of the plugins you name, with secrets replaced by `🔒`, and answers in plain language plus, when a change is needed, one `settings-profile` block. The chat never writes anything by itself: a proposal goes through the same rows and the same confirmation dialog as a profile in a note.

## Before the first question

The chat needs an endpoint with a chat model. Under **Settings → Settings Assistant**, either install the LLM Endpoint Manager (the endpoints come from it) or fill the local list: add the address of your server, for example the one of LM Studio, choose its model in the row, and press **Test connection**. A row that reads **Connected** is usable. If you have no server yet, follow the [local LLM setup guide](https://jkaindl.de/uplink/llm-setup/). Without an endpoint the chat shows **No chat model is set up yet.** with a button **Set up a chat model**.

## Ask

1. Run **Open settings chat**, or use the ribbon icon. The chat opens in the right sidebar.
2. Type your question and send with **Send** or Enter; Shift+Enter starts a new line. Name the plugin in the question, for example "Why does my-plugin stop after twenty rounds?". Plugins whose id or name appears in your message are picked as chips above the input.
3. Correct the chips before you send: remove one with its **x**, add one with the **Add a plugin…** dropdown. Only these plugins' settings go with the question. A list of all installed plugins (id and name) always goes along.
4. **Stop** (the Send button turns into Stop while an answer runs) or Escape cancels a running answer. **New**, under the input, clears the conversation and also stops a running answer. The history is kept in memory only; close Obsidian and it is gone.

## Choose the model

The row at the top of the chat, **Chat**, shows which model answers and switches it: a dropdown with the models of the active endpoint, **Automatic** (the endpoint decides) and a reload button. It is the same choice as the model in the endpoint's row under **Settings → Settings Assistant**. A model you chose that the endpoint no longer lists stays selected and is marked **(saved)**; it is never changed silently. While an answer runs the row is locked. **Other endpoint …** appears when the LLM Endpoint Manager is installed and opens its settings.

The thinking button sits in the same row. It switches the model's reasoning between off and its preferred level; the meaning of the levels is in the settings under **Request**.

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
