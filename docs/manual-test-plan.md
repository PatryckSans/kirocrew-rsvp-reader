# RSVP Reader: test plan for the 16 improvements

How to use: do the setup, then go through the sections. Each case says what to do and what should happen. Cases marked `auto` already have an automated test (see section 0); what is left for you is to check in the real dashboard, mainly the visuals, which no automated test can see.

## 0. What was already tested automatically (and what was not)

| Layer | How to run | Result |
|---|---|---|
| Cleaning and tokenizer (Python) | `cd backend && python3 -m pytest tests -q` | 61 pass |
| API with disposable sessions | `<gateway python> backend/tests/test_server_api.py` | ok |
| Pure front-end logic (Node) | `node --test ui/tests/pure.test.mjs` | 17 pass |
| Real screens (React 18 + jsdom) against the real backend | `cd tests/ui-integration && npm install && bash run.sh` | 16 pass |
| Real data: 7,031 tokenized messages | standalone script | no errors; 1.35% of words split; 6.9% "hard" |

Not covered by any automated test: appearance (colors, spacing, text clipping), the real 340px panel, the chip popover in the dashboard, and performance in the browser. That is what the sections below check.

## 1. Setup

1. Click **Enable** on the RSVP Reader app (the app was reinstalled) and press **Ctrl+Shift+R** in the dashboard. Without this the browser uses the old `.mjs` files.
2. Open a conversation with a few agent replies, preferably with lists and tables. Open the side panel with `+` and choose RSVP Reader.
3. Also open the full page (Apps menu, RSVP Reader) and the ⚡ chip in the composer.
4. For the cases that use controlled text, use **Paste text** with the text from section 8.
5. Before you start, open the browser console (F12). Write down any red `[RSVP Reader]` error that shows up during the tests.

## 2. Getting to the right reply fast

**F1. Only the final reply of each turn** (`auto`)
- 1.1 Open the panel. The selector should show your messages and the reply that closes each turn, without the short lines like "I'll locate…". The button next to the selector should say **Replies only**.
- 1.2 Click **Replies only**. It becomes **All messages** and the list grows (the narration lines show up). Reload the page: the choice is kept.
- 1.3 With **Replies only**, use **↑/↓**. It should skip only between the listed messages.
- 1.4 Select a narration line in **All messages** and switch back to **Replies only**: that message should stay in the selector until you change messages.
- 1.5 On open, the most recent agent reply should be selected (not your question).

**F2. Clean preview, reading time and timestamp** (`auto`)
- 2.1 Each item shows `Agent · clean text (123w · ~1 min · 14:32)`. There must be no `**`, `#` or `|` in the text.
- 2.2 Messages from another day show `06/10 14:32`; messages from today show only `14:32`.
- 2.3 Messages that take less than ~45 s show `<1 min`. Change the WPM and reopen the selector: the estimated time changes.

**F9. New reply notice** (`auto`)
- 9.1 With the panel open and idle, send a message in the chat. When the agent finishes and the conversation stays unchanged for ~6 s, the **New reply in this conversation** bar should appear with **Read it** and ✕.
- 9.2 **Read it** opens the new reply. The bar disappears.
- 9.3 ✕ hides the bar and it does not come back for the same reply.
- 9.4 If the reply is already the one that is open, the bar does not appear.
- 9.5 Known limitation: if the agent goes more than 6 s without writing in the middle of a long task, the bar may appear because of a narration line. Note it down if it bothers you.
- 9.6 With the panel in another (hidden) browser tab, there should be no calls to the backend. Check in Network in F12.

**F16. First use**
- 16.1 Clear the storage (`localStorage.clear()` in the console) and open the panel. The **Quick tour** card should appear.
- 16.2 **Got it** closes the card and it does not come back after a reload (`auto`). **All shortcuts (?)** closes and opens the shortcuts list.
- 16.3 In a conversation with no messages, the panel says "Nothing to read yet. Once the agent replies in this chat, its reply shows up here."

## 3. Reading comfort

**F3. Go back a few words on resume** (`auto`)
- 3.1 Press play, pause with **Space** on any word, press play again: reading restarts 4 words earlier.
- 3.2 Pause, click a word in the Context box (or use **→**) and press play: it must **not** go back at all (you chose the spot).
- 3.3 In Settings, Reading display, set "On resume, go back" to 0: it no longer goes back. Set it to 8: it goes back 8.
- 3.4 Pausing at the start (word 1) and resuming must not cause an error or a negative index.

**F4. Slower start** (`auto`)
- 4.1 At 600+ WPM, press play: the first 5 words should come out visibly slower than the following ones.
- 4.2 Uncheck "Slow start after play" in Settings: the start now runs at full speed.
- 4.3 The ramp applies on every play, including after a pause.

**F5. Remember where you stopped** (`auto`)
- 5.1 Read a long message to ~50%, switch to another message and come back: it should open at the same position with the **Picked up where you left off (50%)** bar.
- 5.2 Close the panel and reopen it: the position still holds.
- 5.3 **Start over** returns to the beginning and erases the saved position.
- 5.4 Read to the end (97% or more) and reopen: it opens from the beginning, with no bar.
- 5.5 Pasted text does not save a position.
- 5.6 Changing a cleaning option in the middle of reading keeps the position (same fraction).

**F6. Time remaining** (`auto`)
- 6.1 Next to `word 12 / 518` (page) or `12/518` (panel) you see `· 1:12 left`. The time decreases as reading advances.
- 6.2 Change the WPM: the remaining time changes immediately. Long pauses (lists, tables) are included in the calculation.

**F13. Visual comfort**
- 13.1 Settings, Reading display: switch the font to **Sans-serif**. The center word changes and still fits in the box (check with a long word).
- 13.2 **Letter spacing** 0.08: the letters spread apart, without clipping the word.
- 13.3 **Highlighted letter at** 20 and then 50: the colored letter moves within the word.
- 13.4 Navigate with **Tab** only: every button and control shows a visible focus ring.
- 13.5 With "Reduce motion" enabled in the system, the Context box does not scroll with animation.
- 13.6 Hover over the buttons ⟲ ⏮ ▶ ⏭ ?: each one shows a tooltip. (With a screen reader, each one has a name.)

## 4. Navigation and discovery

**F7. Shortcuts** (`auto`)
- 7.1 **[** and **]** (or **-** and **=**) change the speed in steps of 20 WPM. They respect the limits of 100 and 1000.
- 7.2 **Alt+→** jumps to the start of the next line or item; **Alt+←** goes back to the start of the current line and, if already at the start, to the previous one.
- 7.3 **Home** goes back to the beginning.
- 7.4 **?** opens the shortcuts list; **Esc** closes it. In the panel, the list does not mention the session keys.
- 7.5 **Esc** also closes Settings and the Paste text box.
- 7.6 **Ctrl+→** and other browser shortcuts are not captured.
- 7.7 While typing in the Paste text box, no shortcut should fire.

**F8. Context box that does not pull the scroll** (`auto` partial)
- 8.1 During play, scroll the Context box up with the mouse wheel: it stops following and **↧ Back to current word** appears.
- 8.2 The button returns to the current word and resumes following.
- 8.3 Clicking a word also resumes following.
- 8.4 While paused, use **→**: the box goes back to following on its own.
- 8.5 Scrolling happens only inside the box; the page does not jump.

**F16/F7. Help always at hand**
- 16.4 The **?** button next to the controls opens the same list. On the full page there is also a shortcuts line under the controls.

## 5. Inside lists and hard words

**F11. Very long words** (`auto`)
- 11.1 Paste the text from section 8. `getUserNameFromSessionStoreFactoryXYZ` appears in three parts in the center field (`getUserNameFrom`, `SessionStoreFactory`, `XYZ`), but **pasted together without spaces** in the Context box.
- 11.2 Ordinary long English words (`straightforwardly`) are **not** split.
- 11.3 Settings, Long words row: "Keep whole" turns off splitting; "max letters" 12 splits more words.
- 11.4 Each part fits in the box without the box changing size on every word.

**F12. Pause on numbers and identifiers** (`auto`)
- 12.1 `v0.7.1`, `02/09`, `spawn_run`, `panel.mjs` come out a little slower than ordinary words.
- 12.2 Settings, Numbers / IDs row, pause 1: same as the others. 3: much slower.
- 12.3 Ordinary words and sentence endings do not change.

**Position chip and highlighted item (from the previous round, now on the new base)** (`auto`)
- 12.4 Inside a list, above the word you see `item 2/3 · list title`; in a sub-item, `item 2.1/3`.
- 12.5 Outside lists and in single-item lists, the chip does not appear.
- 12.6 In the Context box the current item has a soft bar and background; the other items do not move.

## 6. Composer chip and performance

**F10. Reading inside the chip** (verify only in the real dashboard)
- 10.1 Click the ⚡ in the composer. The button order is: **Quick read here** (the highlighted primary button), **Open full page**, **Open in side panel**, **Close**.
- 10.2 **Quick read here** opens a small box with the most recent reply, play/pause, speed and progress.
- 10.3 With **Hide quick read** the box disappears. The popover must not be clipped or close by itself when you press play (if it closes, note it down: it is the open uncertainty of this feature).
- 10.4 A speed change made here also applies in the panel and on the page, the next time they open (same storage).

**F14. Same behavior on both screens** (consequence of the unification)
- 14.1 Repeat 1.2, 3.1, 7.2 and 9.1 on the full page and in the panel: the behavior should be identical.
- 14.2 Change a Settings option in the panel and open the full page: it already uses the same option (and vice versa).

**F15. Context box performance**
- 15.1 Open a message of 2,000 words or more and press play at 800+ WPM. Reading should not stutter or freeze the scrolling.
- 15.2 Measured in jsdom with 6,400 words: from ~30 ms to ~0.7 ms per word. In the browser, the number will vary; what matters is not noticing any stutter.

## 6b. Agent options line

- O1 Open a reply that ends with `[OPTIONS: A | B]` (the ones in this chat end that way). Reading ends at the last word of the text; the options line does not appear in the center field or in the Context box. (`auto`)
- O2 Settings, **Options line** row: **Read them** reads `Options: A, B.` at the end; **Keep as is** shows `[OPTIONS:` as ordinary text; **Skip them** (default) goes back to skipping. (`auto`)
- O3 **Raw** shows the line, because it is the original text.
- O4 A sentence that merely mentions `[OPTIONS: a | b]` in the middle of the text is not skipped: only the whole line is.

## 7. Regressions (what already worked)

- R1 Panel tied to the right conversation, with no session selector; full page with a session selector and **Shift+↑/↓**.
- R2 Clean/Raw: in Raw, the text appears unprocessed and still keeps the message's line breaks.
- R3 Settings: the Minimal, Balanced and Detailed presets change the preview; **Reset to defaults** restores cleaning and display.
- R4 Context box with bold headings, bulleted lists with indentation, separate table rows, code blocks on a single line.
- R5 A large word fits in the narrow panel (without wrapping or clipping).
- R6 Paste text: pastes, reads, and **Back to this conversation** returns to the conversation (panel).
- R7 The chip still opens the full page with the right session.

## 8. Text to paste (Paste text)

```
## Test plan

See the result. Version v0.7.1 published on 02/09 with spawn_run and panel.mjs.

For each contact source
1. Source name and responsible system
2. How the data is made available: API, webhook or file
3. Technical connection documentation
   - manuals
   - API specifications

Long identifier: getUserNameFromSessionStoreFactoryXYZ and my-app-prod-cognito-jwt-authorizer-v2.

| Cat | Value |
|---|---|
| Emphasis | **bold** |
| List | bullet |

End of text, with straightforwardly a long ordinary word.
```

Expected: title read without `##`; `For each contact source` as the list title; chip `item 1/3` ... `item 3/3`, sub-items with `3.1`; identifiers in parts; table read as `Cat, Value.` and `Emphasis: bold.`; "straightforwardly" whole.

## 9. If something fails

- Red error bar or empty panel: open the console (F12) and copy the `[RSVP Reader]` error.
- Old behavior (no chip, no "Replies only"): it is cache. Ctrl+Shift+R, or F12, Network, "Disable cache", reload.
- Panel shows 502: the app's "..." menu, **Sync**.
- After any fix from me, run section 0 again before repeating the manual tests.
