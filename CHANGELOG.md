# Changelog

## 0.2.0

- Replies-only message list (closing reply of each turn), with cleaned previews, reading time and
  hour; "All messages" one click away. A banner offers a new reply once the chat goes quiet.
- Remembers where you stopped in each message; shows time left; steps back a few words when you
  resume; slow start after Play.
- Position chip (`item 3/8 · title`) over the focal word inside lists, current item highlighted
  in the Context box; the Context box keeps the chat's paragraphs, lists and tables.
- Long words are split at their separators; numbers, versions, ids and paths get a longer pause.
- The agent's `[OPTIONS: ...]` line is skipped (Settings: skip / read / keep).
- Settings: reading display (font, spacing, focal letter, rewind, slow start), item-start pause.
- New keyboard shortcuts (`[` `]`, `Alt` + arrows, `Home`, `Esc`, `?`), shortcut list, first-run tips.
- "Quick read here" in the composer chip.
- Internals: playback and loading moved into shared hooks; the Context box is memoized per line.

## 0.1.0

- First version: RSVP playback, composer chip, side-panel tab bound to its chat, Markdown cleanup
  with a Settings screen.
