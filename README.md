# RSVP Reader for KiroCrew

Read an agent's replies at your own pace, one word at a time.

RSVP (Rapid Serial Visual Presentation) flashes each word at a fixed focal point, so
your eyes stay still while the text moves. This app adds it to [KiroCrew](https://kiro.dev):
open it from the composer, from a side-panel tab bound to the current chat, or as a
full page. It cleans the Markdown noise (tables, code, links, paths) so what you read
is what the agent meant, and it keeps your place.

> Status: version 0.2.0. Developed and tested on Linux. macOS is declared in the
> manifest but not yet tested.

## Install

```bash
git clone https://github.com/PatryckSans/kirocrew-rsvp-reader.git
kirocrew app install ./kirocrew-rsvp-reader
```

Then click **Enable** in the dashboard (the `kirocrew app enable` CLI command only marks
the app enabled; it does not start the backend). Requires KiroCrew 0.1.2 or newer.

After an update, hard-refresh the dashboard (Ctrl+Shift+R) so the browser loads the new UI files.

## Using it

| Where | How |
|---|---|
| Composer | The ⚡ chip: **Quick read here** plays the latest reply in the popover; **Open full page** opens the page for this chat. |
| Side panel | Click `+` at the top of the right panel and choose **RSVP Reader**. It binds to the chat it was opened in; there is no session picker. |
| Full page | **RSVP Reader** in the sidebar, with a session picker and a **Paste text** box. |

By default the picker lists your messages and the **closing reply of each turn**, without
the short narration between tool calls (**All messages** shows everything). When a new reply
arrives while the panel is open, a banner offers to read it.

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Previous / next word |
| `Shift` + `←` `→` | Previous / next sentence |
| `Alt` + `←` `→` | Previous / next line or list item |
| `↑` `↓` | Previous / next message |
| `Shift` + `↑` `↓` | Previous / next session (full page only) |
| `[` `]` or `-` `=` | Slower / faster, 20 WPM per press |
| `Home` | Back to the start |
| `Esc` | Close Settings, help or the paste box |
| `?` | Show the shortcut list |

## What it does

- **Reading pace:** pauses on punctuation, list items, numbers, identifiers and long words;
  a slow start after Play; a few words of rewind when you resume; time left; the position of
  each message is remembered.
- **Markdown cleanup:** emphasis, headings, lists, tables, code, links, URLs, paths and hashes
  become short readable units. A `[OPTIONS: A | B]` line from the agent is skipped. **Clean / Raw**
  shows the original text.
- **Context box:** keeps the chat's own paragraphs, lists and tables; the current list item is
  highlighted and a chip over the focal word shows `item 3/8 · list title`. Click any word to jump.
- **Settings (⚙):** presets (Minimal, Balanced, Detailed), per-category rules and pauses, and the
  reading display (font, letter spacing, focal letter, rewind, slow start).

## Privacy

The app reads your KiroCrew sessions from `~/.kiro/crew/sessions` (read-only) through its own
local backend. Speed, settings and reading positions live in the browser's `localStorage`. It
makes no network requests and declares no permissions beyond its own API prefix.

## Development

```text
app.json          manifest (name, version, author, store text, entry points)
backend/          aiohttp backend: sessions, Markdown cleanup (md_clean.py), tokenizer
ui/               plain ES modules, no build step
  pure.mjs        framework-free logic (unit-tested)
  player.mjs      hooks: playback, conversation reader, keyboard
  rsvp-core.mjs   what is drawn
  index.mjs       full page    panel.mjs  side-panel tab    session-control.mjs  composer chip
tests/ui-integration/   React 18 + jsdom against the real backend
docs/             manual test plan (Portuguese)
```

```bash
cd backend && python3 -m pytest tests -q          # cleanup + tokenizer (needs pytest)
node --test ui/tests/pure.test.mjs                # pure front-end logic
cd tests/ui-integration && npm install && bash run.sh   # UI against the real backend
```

`backend/tests/test_server_api.py` needs aiohttp, which only the gateway's Python has; run it
with that interpreter. See [`tests/ui-integration/README.md`](tests/ui-integration/README.md)
for what the integration suite covers (and what jsdom cannot show).

## License

[Apache-2.0](LICENSE). Author: Patryck Sans.
