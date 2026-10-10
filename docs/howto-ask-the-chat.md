# Ask the chat

The settings chat lets a local model draft a profile from a question. The model sees the settings of the plugins you name, with secrets replaced by `🔒`, and answers in plain language plus, when a change is needed, one `settings-profile` block. The chat never writes anything by itself: a proposal goes through the same rows and the same confirmation dialog as a profile in a note.

## Before the first question

The chat needs an endpoint with a chat model. Under **Settings → Settings Assistant**, either install the LLM Endpoint Manager (the endpoints come from it) or fill the local list: add the address of your server, for example the one of LM Studio, choose its model in the row, and press **Test connection**. A row that reads **Connected** is usable. If you have no server yet, follow the [local LLM setup guide](https://uplink.jkaindl.de/llm-setup). Without an endpoint the chat shows **No chat model is set up yet.** with a button **Set up a chat model**.

## Ask

1. Run **Open settings chat**, or use the ribbon icon. The chat opens in the right sidebar.
2. Type your question and send with **Send** or Ctrl+Enter (Cmd+Enter on macOS). Name the plugin in the question, for example "Why does my-plugin stop after twenty rounds?". Plugins whose id or name appears in your message are picked as chips above the input.
3. Correct the chips before you send: remove one with its **x**, add one with the **Add a plugin…** dropdown. Only these plugins' settings go with the question. A list of all installed plugins (id and name) always goes along.
4. **Stop** cancels a running answer. **New chat** clears the conversation. The history is kept in memory only; close Obsidian and it is gone.

The thinking button in the header switches the model's reasoning between off and its preferred level. The meaning of the levels is in the settings under **Request**.

## Read what was sent

Under each of your questions a fold-out **Sent context** shows the plugins, the **Withheld keys (names only)**, files that could not be read, the endpoint, the model and the **Full prompt**. This is the text that left your machine, to the endpoint you configured. If that endpoint is a hosted provider, the settings of the chosen plugins went there, minus secrets.

## Read the answer

The answer streams in. The model's own reasoning, if the endpoint sends it, is folded under **Thoughts**. Because the answer comes from a model, it is treated as untrusted text: images and embeds are not loaded, they appear as plain text or code, and HTML is shown escaped. Links stay and need a click.

A `settings-profile` block in the answer is drawn like a profile note: check rows, the model's reasons as `Reason: …`, and an apply button. The model knows a key only by its name, so it can invent keys (shown as **key not found in file**) and misjudge what a key does. The rows catch the first; you are the check for the second.

## Apply or keep

- Apply with the button under the rows. The dialog, the snapshot and the report are the same as for a note. The snapshot's origin reads `chat:<time>/<model>`.
- **Save as profile note** keeps the proposal as a note for another vault (see [Align two vaults](howto-align-two-vaults.md)). Withheld values are named in a line under the button.

If something goes wrong, [Troubleshooting](troubleshooting.md) lists the messages.
