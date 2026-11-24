# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.12.2] — 2026-11-24

### Fixed

- **A key or token in a field with an ordinary name no longer goes to the model.** `sk-proj-…`, `AKIA…` and `Bearer …`, also glued to a word or underscore (`key_sk-…`), in a description, note or template field of a plugin's settings are blanked in the chat context, in saved profile notes, in the raw view of a chat block and in the settings the API hands to other plugins; before, only values under names like `apiKey` were left out and such a text went out in clear text. The review table is unchanged: a row is locked by its name, not by its text.

- **Saving a profile as a note no longer fails when the profile contains hundreds of thousands of backtick runs** (the fence length was computed with a spread over all runs and hit the argument limit of the engine, around 150,000 runs).

## [0.12.1] — 2026-11-18

### Changed

- **The model row follows the endpoint manager more closely** (shared library obsidian-kit 0.93.0): when the manager is switched off or comes back, the model row notices within about two seconds and redraws, without a restart.
- **Profile blocks in a chat answer are found by the shared fence scanner** (code-kit 0.73.0, `listFences`) and now follow CommonMark exactly: a fence line whose info string carries a backtick after `settings-profile` is no fence, and a `settings-profile` fence that sits inside another code fence is part of that fence and is not offered as a profile.
- **A profile fence written with a tab is read the way Obsidian reads it** (shared fence scanner of code-kit 0.75.0): a tab between the fence and `settings-profile` no longer hides the language, and a tab as indentation counts as columns, so such a block in a chat answer is offered as a profile.
- **A removed `iframe`, `frame`, `object` or `embed` in a model answer stays in the page for another 250 ms as a hidden, empty shell** (link guard of code-kit 0.73.0). The error box "A JavaScript error occurred in the main process" that Obsidian could show for an `iframe` with an `app:`, relative or `file:` target no longer appears.
- **The chat window checks the shape of a stored chat before it loads it** (shared chat window of obsidian-kit 0.93.0): a chat file with a damaged history is refused with a message instead of passing silently. The copy buttons of the chat and of the reasoning block share one component; they look the same.

## [0.12.0] — 2026-11-14

### Added

- **A new command "Save plugin settings as profile note…" saves the current state of a plugin as a profile note, without the chat or a model.** Choose a plugin; its settings file becomes a `settings-profile` note (same name, same place and same withholding of secrets as "Save as profile note" in the chat), and a message names the values that were left out. Importing is the note itself: put it into another vault and apply it through the usual check and dialog. A plugin without a settings file, with an unreadable file, or with an empty one is refused with a message and no note is created; the settings of Settings Assistant itself are never offered.

### Changed

- **The model row and the model choice now name and bind the endpoint the endpoint manager really uses** (before: the first switched-on one, even when it was not reachable). A model choice made while the chosen endpoint is switched off or deleted now applies to the automatically chosen endpoint.
- **The model dropdown in the chat lists the models of all your endpoints, grouped by endpoint** (shared model row of obsidian-kit 0.88.0). The first entry is "Automatic" (with the endpoint and its default model), every endpoint has its own group with "Default (…)" and its models, the last entry "Manage endpoints …" opens the settings of the endpoint manager and selects nothing. A choice fixes endpoint and model for this plugin only, never the model of another plugin; an endpoint that does not answer keeps its group with a disabled note ("not reachable", "no models reported"). If the chosen endpoint was switched off, deleted or lost its key, the row shows "Automatic" with a warning symbol and the reason in its tooltip, and your saved choice stays untouched. The row redraws itself when the endpoint or the choice changes elsewhere (for example in the settings), and the open list is never redrawn while you are choosing. Without the endpoint manager the row stays a plain list as before. The thinking-level list also knows the level "minimal" (offered by gpt-oss).

## [0.11.2] — 2026-11-14

### Security

- **Links and forms in model answers are now cut harder.** The link guard of the shared library (obsidian-kit 0.88.0, code-kit 0.68.0) removes event-handler attributes (`on*`) from every element of an answer, and `form`, `formaction`, `ping`, `commandfor`/`popovertarget` and `label for` as well; a model answer can no longer submit a form or fire a script-like attribute from the chat window. Only the four guard modules moved to the new version, the rest of the library stays on 0.77.0. The GUI smoke has a new check (P42) that measures this in the real chat window.

## [0.11.1] — 2026-11-03

### Fixed

- **The "Plugins (n)" button no longer relies on the `:has` selector.** The store scan flags `:has` in a stylesheet, which would have cost the review grade "Passed"; the chat now carries a class while the input has focus, and the button and the chip row follow that class. Nothing changes on screen: with the keyboard open on a phone the chips still fold behind the button.

## [0.11.0] — 2026-11-03

### Changed

- **On a phone, while the keyboard is open, the row of plugin chips folds into a button "Plugins (n)"** next to the New icon (n is the number of chosen plugins); one tap shows the row and lets you pick or remove plugins as before, a tap into the input hides it again. The row cost 52 px, so the answer area showed 6.7 lines on a 390 × 508 screen; now it shows 8.6 lines (10.3 on 390 × 546). On the desktop and with the keyboard closed nothing changes.
- **On a phone no empty strip is left between Send and the keyboard any more, and the floating navigation bar no longer covers the bottom row of buttons.** Obsidian shrinks its app container when the keyboard opens and sets its safe-area variable to the keyboard height; the plugin's own spacing rule for the chat counted that twice (on an iPhone it left the chat 52 px). The library now sets the spacing once, and the plugin's rule is gone. Measured in Obsidian's mobile emulation set the way an iPhone reports it (390 × 844, keyboard 336 px): keyboard closed, the chat ends 2 px above the navigation bar; keyboard open, 0 px empty and about seven lines of answer with a plugin chip in the chat (about nine without the chip row). Not yet tried on a device with this build (obsidian-kit 0.76.0).
- **The thinking level in the model row is a symbol where the row is narrow** (▄ for medium, next to the brain icon), so the model name keeps its room; the list of levels still shows the full names, and an entry now reads "▄ Medium" (obsidian-kit 0.76.0).
- **The past-chats button stays hidden on a phone while "Chats to keep" is 0.** A rule for the phone layout had shown it anyway (obsidian-kit 0.76.0).
- **The copy buttons of answers are easier to hit with a thumb on a phone** (44 × 44 px hit area, the icon keeps its look; obsidian-kit 0.76.0).
- **The row "Level picker in chat" is gone from Settings → Request for good,** also for a plugin that had it switched on before: the model row always shows the level, so the row did nothing. The earlier note that a switch that was already on stays visible no longer holds (obsidian-kit 0.76.0).
- **If you had the chat in the right drawer on a phone or tablet, it now opens as a tab in the main area the next time you open it.** The saved layout kept the chat in the drawer for good, so the fix of 0.10.0 only reached new installs. The drawer copy is closed first; your conversation stays (the plugin holds it, not the tab). On the desktop nothing changes: the chat stays in the right sidebar (obsidian-kit 0.77.0).
- The shared library moved from obsidian-kit 0.74.0 to 0.77.0. Nothing else of the skipped releases reaches this plugin: 0.75.0 adds a writer for code-block bodies, 0.76.0 a choice dialog and a status indicator (the Request section draws its status line with the latter, same look), 0.76.1 only a shared helper for the chat spacing.

### Documentation

- The README and the chat how-to show the dialog **Past chats** (new picture), and the chat picture shows the current window: model row above the input, New as an icon, no heading row.

### Tested

- The layout measurement (`npm run chat-layout --ort schublade-dann-befehl`) puts the chat in the drawer, runs a round, calls the command and checks that the tab sits in the main area with the round still in the log. A unit test covers the same case with a counter-case on the desktop.
- The layout measurement takes `--tastatur <px>` (298 gives the 390 × 546 container) and reports the "Plugins (n)" button; GUI smoke point P41 checks the button (desktop: hidden, phone class with focus: visible and the chip row folded, tap opens and closes it, without focus both back to normal).
- The layout measurement (`npm run chat-layout`) sets the keyboard the way the device reports it (app container shrinks, safe-area variable on the keyboard height, window height unchanged); the former viewport shrink is kept as `--tastaturart viewport`. A unit test now guards that the plugin sets no spacing on the chat host itself (a mutation test with the old rule turns it red).

## [0.10.0] — 2026-11-01

### Added

- **Past chats, off until you switch them on.** With the history on, every conversation is filed as one `.json` file in a vault folder (default `Settings Assistant/Chats`) at the end of each round, and a history button next to **New chat** opens the list: search by title, open a chat to continue it (it writes back into its own file), **Save as note** (a Markdown copy beside it, never read back) and **Delete** (final, with a confirmation). The file holds what the chat window shows, including the **Sent context** (the settings values that were sent to the model); withheld keys stay out, as in the window. Two new rows under **Settings → Settings Assistant → Past chats**: **Folder for past chats** (empty means the default) and **Chats to keep** (0 to 500; **the default is 0, so the history is off after the update** and nothing is written to your vault until you raise it, for example to 50; lowering it later deletes the surplus at the next save). New commands **Start new chat** and **Open past chats…** (only while the chat is open). Chats were kept in memory only until now (obsidian-kit 0.73.0, code-kit 0.40.0).
- **On a phone the chat opens as a tab in the main area** instead of the right drawer. In the drawer Obsidian's own tab selector and margin took 155 px under the buttons (measured in Obsidian's mobile emulation, 390 × 844 and 390 × 508); in the main area the chat ends just above Obsidian's floating navigation bar, and the plugin leaves room for it. A chat that is already open stays where it is. Not yet tried on a device.

### Changed

- **The model row is one line above the input** (model, a hint when the model is not listed, thinking level, reload), and the heading row "Chat + model" and the separate thinking row at the top are gone. The word "Chat" is no longer shown; the dropdown still announces it (obsidian-kit 0.73.0).
- **The setting "Level picker in chat" is gone from Settings → Request** (German "Stufenwahl im Chat"): the model row always shows the thinking level as a dropdown, so the switch did nothing since the model row moved (obsidian-kit 0.73.0). A value you saved earlier stays in `data.json`; a switch that was already on is still shown, so you can turn it off.
- **The thinking level is a dropdown with the levels of the chosen model** (an icon in front), no longer a button that toggles. Claude models offer low to max as far as the model has them, local families off, low, medium, high, a model without a recognised family on LM Studio or Open WebUI the generic list, Haiku 4.5 and Claude over Open WebUI no thinking element. "Very high" and "max" say that answers get long and cost more. The settings section **Request** lists the same six levels ("very high" and "max" are new).
- **A stored thinking level "off" now sends the model's own default when the model is Claude** (more thinking, more time and cost per answer) until you lower the level; a stored "max" on a model without it falls back to the next lower level. For Opus 4.6, Sonnet 4.6 and Opus 4.5 the plugin no longer sends `temperature`, `top_p` and `top_k`, on any backend (code-kit 0.39.0).
- **"New" is an icon** (square with a pen, tooltip "New chat") next to Send instead of a text button, and it is locked while the conversation is empty and while an answer runs. With the history on, it files the conversation, clears the window and says "Chat saved to past chats" without asking; with the history off (the default), it asks before it discards.
- **With the keyboard open on a phone the chat keeps more room for the answer.** Under 640 px of window height the input and Send share the first row, and New, past chats and the model row (model, thinking level, reload) share the second, under the text field; Send never sits next to New. In Obsidian's mobile emulation at 390 × 508 (keyboard open, navigation bar reserved) the answer area grows from 2.8 to 6 lines with a plugin chip in the chat; it is still short of ten lines, because the chip row and the navigation bar take their share (obsidian-kit 0.74.0). Above 640 px the layout is as before.
- **On a phone the status line shows only while an answer runs** (thinking, writing) and takes the place of the then locked model row; "done", "stopped" and the error stay in the conversation. On the desktop the status line is unchanged (obsidian-kit 0.74.0).
- **On a phone New, past chats and reload are 44 × 44 px** (they were 30 × 26), so they are easier to hit with a thumb; the icons keep their size. In a narrow row the model name in the dropdown is cut, and the tooltip of the dropdown shows the full name (obsidian-kit 0.74.0).
- **Plugin chips and "Add a plugin…" always stand in one line,** on one centre line, with a gap to the model row above (on a phone the chip is as tall as the dropdown). Long plugin names are cut with an ellipsis, and many chips scroll sideways instead of wrapping.
- The shared library moved from obsidian-kit 0.72.0 to 0.74.0 and from code-kit 0.38.0 to 0.40.0 (`anthropic-wire` now comes from code-kit). Nothing else of the skipped releases reaches this plugin: 0.37.6 changes the live indexer, 0.38.0 changes line-ending detection and the comment of the link guard, neither is used here.

### Tested

- The GUI smoke now has 40 points (P39 history on the real adapter: file written without a key, New files and clears, list, open, export, delete; P40 history off). It no longer clicks the locked New icon blindly: it sends a message first and checks the result of the click.
- Smoke point P32 now measures the position of the model row geometrically (above the input), because the library moves the row into the composer and the DOM order no longer says where it stands; the unit test checks that the model row is a direct child of the composer exactly once after repeated redraws and that the extra area holds only the chips.
- `scripts/chat-layout.ts` measures the thumb criteria of the chat in a 390 × 844 and a 390 × 508 (iOS keyboard) emulation, light and dark.

## [0.9.2] — 2026-10-26

### Changed

- **The captions under an answer are easier to read and to tap.** "Raw block (secrets redacted)", "Sent context" and "Full prompt" are no longer pale grey: the contrast against the sidebar is now 6.2:1 in the light theme and 7.0:1 in the dark theme (it was 2.1:1 and 2.6:1). The two lines you open and close are at least 24 px high, and on a phone 44 px, like Obsidian's own buttons.
- **The question stands out more in a narrow sidebar.** Its border is now `--text-faint` instead of the almost invisible border colour: 2.1:1 in the light theme and 2.6:1 in the dark theme against the sidebar (it was 1.2:1 in both) (obsidian-kit 0.72.0).
- **A link the chat window disabled now looks like plain text.** A `javascript:`, `data:`, `file:`, `app:` or (while the option is off) `obsidian://` link no longer shows the link colour, underline, pointer and arrow, because it does nothing; a normal link is unchanged (obsidian-kit 0.72.0, replaces "it still looks like a link" from 0.9.1).
- The shared library moved from obsidian-kit 0.70.0 to 0.72.0 and from code-kit 0.37.5 to 0.38.0. Nothing else changes for you: the guard against an endless re-resolve and the locked thinking button need wiring this plugin does not use, and the live-indexer and line-ending changes belong to other plugins.
- The README picture of the chat (`docs/images/chat.png`) is recorded again with the new look.

## [0.9.1] — 2026-10-25

### Changed

- **Links in answers are checked by the shared chat window.** A link that could run a script or open a file (`javascript:`, `data:`, `vbscript:`, `file:`, `app:`) never works, and an `obsidian://` link loses its target; it still looks like a link, but a click does nothing (obsidian-kit 0.70.0; the plugin's own check is gone).
- **The question looks like the answer.** It has the same type size as the answer (it was larger) and a thin border, so it stands out in a narrow sidebar (obsidian-kit 0.70.0).
- **A network error names its technical reason.** The error line adds the message in brackets, with keys and tokens masked and cut to one line; a time-out names the seconds as a whole number.
- The documentation now says what was measured on mobile: the chat was tried in Obsidian's mobile emulation on the desktop (controls reachable with a long history on a 390 × 844 and a 320 × 568 screen, no console errors, the key from the secret storage), not on a device. The on-screen keyboard, touch scrolling and the network path to an endpoint on your local network are still open.

### Fixed

- **The settings tab rebuilds every time it opens.** The hook that refreshes the snapshot list on opening was removed when the tab closed, so only the first opening showed an up-to-date list; it now stays until the plugin unloads.

## [0.9.0] — 2026-10-24

### Added

- Claude can be used as an endpoint of the LLM Endpoint Manager: an endpoint with the provider "anthropic" now shows up in the chat (the plugin did not ask the manager for it before).

### Changed

- The chat now uses the library's chat window (the same building block as the chats of the other plugins). What you will notice: Escape stops a running answer; when the server rejects a request, its reason appears in the error line (until now only the kind and status did); the last failed round offers "Send again"; question and answer have copy buttons; the thinking block folds shut after the answer; a timer shows how long the answer took and a status line ("thinking", "writing", "done") is announced to screen readers; the empty state ("No chat model is set up yet.") has a title.
- The role labels "You" and "Assistant" are gone. "New chat" is now "New" (German "Neu"), sits under the input and also stops a running answer. The error texts for an unreachable endpoint, a timeout, or a missing endpoint come from the library and read differently.
- A model row at the top of the chat shows which model the chat uses and switches it: the models of the active endpoint, "Automatic", a reload button, and the thinking button inside the same row (there is no second button any more). A chosen model that the endpoint no longer lists is marked "(saved)" and never changed silently; the row is locked while an answer runs; "Other endpoint …" opens the settings of the endpoint manager.
- Kit update (obsidian-kit 0.63.0 → 0.67.1, code-kit 0.31.0 → 0.36.0). In a narrow sidebar the snapshot list in the settings no longer lets the details column ("3 days ago · 14 changes") push the label out: the details are capped at 45 % of the row and cut with an ellipsis (the full text is in the tooltip), the label keeps its room.

## [0.8.0] — 2026-10-23

### Added

- Hosts with an agent loop can use the tools through the library's tool contract: the plugin API now carries `version: 1` and `executeTool`, next to the unchanged own contract (`apiVersion` 1, `execute`). Koda lists `read_settings` and `propose_settings` as tools of Settings Assistant. Writing needs two confirmations, the host's (it sees the files the call can touch) and then the plugin's own diff dialog; nothing is written without both. See `docs/API.md`.

## [0.7.0] — 2026-10-18

### Changed

- Kit update (obsidian-kit 0.61.0 → 0.63.0, code-kit 0.28.0 → 0.31.0). The thinking block of the chat has a copy button, and long lines in the live answer wrap instead of running off the right edge.
- The thinking button says "Thinking: lowest level" with a tooltip that gives the reason when "off" is not possible (Gemma 4 on LM Studio, Claude); the text now comes from the kit and is the same in every plugin that has the button.
- LM Studio: whether a model thinks or sees images now comes from its metadata instead of only its name, so the thinking button can appear for more models.
- The "Request" settings show a button "Set family in the manager" next to the hint "Model family detected", warn when a request would load another model in LM Studio and push a loaded one out (JIT displacement), and name the Claude field "Thinking effort (effort)".

### Documentation

- The README describes the Community Store install, and the LLM setup guide links point to the new address.

## [0.6.0] — 2026-10-16

### Fixed

- **Gemma 4 on LM Studio: the model's thinking no longer shows up as the answer in the chat.** It writes its thinking into the answer text without an opening marker and closes it with `<channel|>`; the chat now moves that text into the collapsible thinking block and shows only the answer.
- The chat's thinking button shows "lowest level" for Gemma 4 on LM Studio, where thinking cannot be switched off completely (LM Studio ignores `none` for that model, so "off" sends the lowest effort and the model thinks a little).

### Changed

- **In the chat, Enter sends the message and Shift+Enter starts a new line,** as in the other chat windows. Ctrl+Enter and Cmd+Enter still send. Before, only Ctrl/Cmd+Enter sent.
- **Kit pins raised to `obsidian-kit` 0.61.0 and `code-kit` 0.28.0** (from 0.60.1 and 0.27.1). Visible effects of the skipped releases (obsidian-kit 0.60.2, 0.60.3, 0.61.0; code-kit 0.27.2, 0.28.0): Gemma 4 on LM Studio sends the lowest thinking effort for "thinking off" (see above); the request section names a backend or model family the plugin does not know yet instead of failing; if the LLM Endpoint Manager is switched on after this plugin, the endpoint subscription now catches up instead of staying silent for the session; the snapshot list no longer needs a placeholder for the active entry. Nothing else in the copied building blocks reaches this plugin.

## [0.5.0] — 2026-10-14

### Changed

- Kit pins raised to `obsidian-kit` 0.60.1 and `code-kit` 0.27.1 (from 0.59.1 and 0.24.0). Visible effects of the skipped releases (obsidian-kit 0.60.0, 0.60.1; code-kit 0.25.0, 0.26.0, 0.27.0, 0.27.1):
  - **Chat header:** the thinking button now has a visible gap between its icon and its label (the plugin's stylesheet carries the kit rules).
  - **Request section:** a hint about discarded request settings lists them sorted instead of in stored order.
  - **Snapshot list:** the rows are announced as plain buttons that open the restore dialog, no longer as toggles.
- **Plugin IDs:** the check that keeps a profile or a snapshot from writing outside `plugins/<id>/` now comes from the kit. Besides what it rejected before, it refuses IDs longer than 128 characters, IDs ending in a dot and Windows device names (`con`, `nul`, `com1` …). None of the 8912 IDs of the Community store is affected. The note name `Settings profile YYYY-MM-DD HH-mm` is unchanged.
- **Chat:** the running answer is built once and then only updated, instead of being torn down and rebuilt with every streamed piece. Scrolling, text selection and the open thinking block stay where they are while the answer grows.

## [0.4.1] — 2026-10-12

### Changed

- **Endpoint rows:** the "move up" and "remove endpoint" buttons stay together, and the address and the model ID stay fully visible at normal width; in a narrow window the block of model and buttons moves as a whole into a second line (obsidian-kit 0.59.0–0.59.1). The key field gives way first, so its placeholder may be shortened.
- **Request section:** for a model whose family or backend is not known yet, the section now reads "Family: not detected yet · Backend: not detected yet" and notes that this is normal for a freshly added endpoint (it was "unknown"; obsidian-kit 0.59.0).
- **Chat:** scrolling up while a reply streams keeps your position, as before. The kit now follows the end by itself; the chat tells it whether you were at the bottom, so the view does not jump back.
- Kit pins moved to obsidian-kit 0.59.1 and code-kit 0.24.0 (skipping obsidian-kit 0.56.1–0.58.0, whose changes nothing in the plugin shows).

## [0.4.0] — 2026-10-12

### Changed

- **The endpoint list shows the context length.** Under a reachable row with a model it now reads "Context: loaded N · max M tokens" (only "max M" when the model is not loaded, nothing when the server names no number). The line comes from the shared kit and asks LM Studio or Ollama after the status check.
- **A row's model can be set back to "— (server picks)".** The model selection of every row offers this option again (the "global model" option stays gone): choosing it removes the model from that row, and the row then sends no model name, as before for an empty row.
- **Clearer status hints.** The tooltips of the status icons and the input hints use the kit's wording (EN/DE): a timeout now says "network unreachable (wrong network / VPN off?)", a server that is not an LLM API says "wrong path/service?", and "Not reachable" no longer ends in a dangling dash.
- **Masking before a request is broader.** Secrets are masked more often on their way to the server: a `Bearer` token is caught in any case and from 8 characters (it was 16, lower case slipped through), also a token with `=` in it. Prose such as "Bearer authentication" is masked too and reaches the server as `Bearer [redacted-token]`.
- **Remote targets in the chat answer.** A link or image target split over a line break, or after a lone carriage return, no longer keeps a remote image alive; a Mermaid diagram that could load something from outside is shown as plain text (the source stays readable) and is not drawn; the check of CSS targets stays linear on long answers. Answers are still shown as text.
- **Long answers render faster and leak less.** The guard against remote targets while an answer streams in checks only what changed (a 100 KB answer took 3.2 s, now 1.3 s in the measurement of the kit) and the removal of a model's `<think>` block is linear (50 000 unclosed `<think>` took seconds, now under a millisecond).
- The shared kit is updated to obsidian-kit 0.56.0 and code-kit 0.23.0 (one step, no intermediate pin).

## [0.3.0] — 2026-10-10

### Changed

- **The Model setting is gone.** The model now lives only in the endpoint row. On the first start after the update, the old value moves once into every endpoint row that has no model of its own, and `localModel` is removed from `data.json`. A value without any endpoint row (no local endpoints at all) is lost; with the LLM Endpoint Manager installed the rows are filled too, but its endpoints still decide.
- A new endpoint row inherits no model any more, and a model that is set in a row can no longer be switched back to "empty" in the row's selection (the option **global model** is gone). A row without a model sends an empty model name: the chat then shows an empty **Model** in the sent context and the snapshot origin reads `chat:<time>/`.
- The shared kit is updated (code-kit 0.17.0). The check for remote targets in the chat answer now treats link and image targets longer than 2048 characters as remote (fail closed), so such a target is neutralised instead of rendered.

## [0.2.0] — 2026-10-09

### Changed

- The chat connection now runs on the shared obsidian-kit connection: endpoint source, endpoint list, model lists, request parameters, the Request section and the check of every answer come from one place. The Settings tab shows them in one block under **Chat model**.
- The wait for the first answer chunk is 10 minutes instead of 5 (a model that loads on demand needs the time). A request that ends at the token limit without any text is still an error, and the deviation **Empty answer: thinking used up the token budget** now also appears in the Request section.
- **Endpoint** (choice at the LLM Endpoint Manager) only applies with the manager installed; without it the first reachable local endpoint is used, as the list says.
- The error text for a missing endpoint is now **No endpoint available — set one up in the plugin settings.** (it was the code `no-endpoint`).
- Without the manager, the **Model** row now sits below the endpoint block and applies to list rows without a model of their own; each row can also pick its own model.
- Secrets are masked before the text leaves the plugin and restored in the answer: tokens, `Bearer` headers and private keys in your question go to the server as placeholders. Answers are shown as text, so an image link carrying a placeholder cannot send a secret out.
- Local API keys are moved from `data.json` into Obsidian's secret storage at the first resolve, as before; this now needs Obsidian 1.11.4 (already the minimum).

## [0.1.1] — 2026-10-03

### Changed

- The README now shows screenshots: a settings profile in a note, the apply dialog, the restore dialog, the chat sidebar and the snapshot settings.

## [0.1.0] — 2026-10-03

### Added

- Profiles as notes: a fenced `settings-profile` block (JSON, `version: 1`) shows a live comparison with the current files in reading view and an apply button.
- Check rows for every key (will change, already set, key not found in file, plugin not installed, file is not valid JSON, path blocked by a non-object value, secret, read-only in this version), with the profile's reason shown next to the measured values.
- An apply dialog that groups rows by file, pre-selects only real changes and tells which switched-on plugins will be reloaded; the write is confirmed by the user every time.
- A write path with a snapshot before the first change (nothing is written if the snapshot fails), plugin off, re-read, patch, plugin on, read-back with a report of values the plugin corrected, and stop on error without automatic rollback.
- Writable targets in version 1: `plugins/<id>/data.json` of other plugins and `hotkeys.json`; `app.json`, `appearance.json`, `core-plugins.json` and `community-plugins.json` are shown read-only. The plugin's own settings are never written through a profile.
- Secrets are left out of profiles, apply reports, the chat context, saved profile notes and the API: the name must match (`apikey`, `token`, `secret`, `password`, `credential`, `cookie`, `email`, `auth` except `author`) and the value must be non-empty text, an object or a list.
- Snapshots with a two-phase manifest, grandfather-father-son retention (defaults 6 today, 7 days, 4 weeks, 6 months, editable in the settings) and a restore dialog that marks files changed since the apply or without a checksum and leaves them unselected.
- Commands **Undo last apply** and **Open settings chat**, and the snapshot list in the settings tab.
- A settings chat in the sidebar: plugins as chips suggested from the question, a fold-out **Sent context** with plugins, withheld key names, endpoint, model and the full prompt, proposals drawn with the same check rows, **Save as profile note**, a fold-out raw block with secrets redacted under every proposal, and the model's Markdown neutralised before it is rendered.
- Endpoints through the LLM Endpoint Manager when installed, otherwise a local list with connection status; sampling and thinking level through the shared request section; a help row at the top of the settings tab.
- Plugin API v1 (`app.plugins.plugins["settings-assistant"].api`): redacted reading, plan, apply with the plugin's own confirmation dialog, and the tool definitions `read_settings` and `propose_settings`; see `docs/API.md`.
- English and German interface; README in both languages and user documentation after Diátaxis under `docs/`.

### Changed

- The minimum Obsidian version is raised to 1.11.4, because API keys now live in the keychain (also in the local endpoint list without the Endpoint Manager).

### Known issues

- The snapshot list (kit `version-list`) sets `aria-pressed="false"` on its action buttons, although it is not a toggle; a kit task is open (select/action mode), until then it stays as is.
- API keys live in Obsidian's secret storage, also in the local endpoint list without the Endpoint Manager; existing plain-text keys are migrated on first start and removed from `data.json`. This is why the plugin requires Obsidian 1.11.4 or newer; where secret storage is missing, the plain text would stay until the migration.
- JavaScript sorts numeric keys such as `"10"` to the front of an object, so inserting them through a profile can change the key order.
- Chat answers are shown without code formatting: backticks and runs of three or more tildes are replaced by look-alike characters before rendering, so no code block or inline query of another plugin can run on model output. Proposals are shown separately, with the raw block (secrets redacted) in a fold-out.
