# UI integration tests

The real `ui/*.mjs` modules, rendered with React 18 in jsdom, talking to the
**real backend** (`serve.py`) over a throw-away sessions directory. They cover what
unit tests cannot: the panel binding to its conversation, the Replies-only picker,
keyboard, list chip and item highlight, resume rewind, ramp-up, remembered position,
new-reply banner, paste, settings persistence and the composer chip.

```
cd tests/ui-integration
npm install          # jsdom 24.1.3, react 18.3.1 (pinned)
bash run.sh          # starts the backend, runs `node --test ui.test.mjs`, stops it
```

jsdom has no layout engine, so nothing here proves how it *looks* — see
`../../docs/manual-test-plan.pt-BR.md` for the manual checks.
