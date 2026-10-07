import fs from 'node:fs'
import {
  test, assert, mount, unmount, $, $$, text, btn, click, key, settle, waitFor, sleep, root$, focalWord, caption,
  core, Panel, Page, Chip, api, calls, navigations, w, React, act, setHeader,
} from './harness.mjs'

const SESS = process.env.SESS_DIR + '/dashboard_chat-7-1000.jsonl'
const picker = () => $('select[aria-label="Message to read"]')
const options = () => [...picker().options].map((o) => o.value)
const label = () => ($$('div').find((d) => /^\d+\/\d+/.test(d.textContent) && d.children.length === 2) || {}).textContent
const idx = () => Number((text().match(/(\d+)\/\d+( · [\d:]+ left)?\d+%/) || [])[1]) // "12/123 · 0:42 left40%"
const speed = () => Number(text().match(/Speed: (\d+) WPM/)[1])
async function choose(el, value) {
  await act(async () => { el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })) })
}
async function loaded() {
  await waitFor(() => picker() && $('button[aria-label="Play"], button[aria-label="Pause"]'), 5000, 'panel loaded')
  await settle(50)
}

test('panel: binds to the conversation, lists only closing replies, defaults to the newest', async () => {
  await mount(Panel)
  await loaded()
  assert.deepEqual(options(), ['5', '4', '3', '0'])           // narration (1) hidden
  assert.equal(picker().value, '5')                            // newest assistant message
  assert.match(picker().options[0].textContent, /Agent · De nada, ate logo\. \(\d+w · <1 min · /)
  assert.ok(!/\*\*/.test(picker().options[2].textContent), 'preview is cleaned')
  assert.match(text(), /Quick tour/)                           // first-run tips
  await unmount()
})

test('panel: "All messages" shows the narration too and the choice survives a remount', async () => {
  await mount(Panel)
  await loaded()
  await click(btn('Replies only'))
  assert.deepEqual(options(), ['5', '4', '3', '1', '0'])
  await unmount()
  await mount(Panel)
  await loaded()
  assert.deepEqual(options(), ['5', '4', '3', '1', '0'])
  assert.ok(btn('All messages'))
  await unmount()
})

test('panel: keyboard — word, line, speed, help, escape', async () => {
  await mount(Panel)
  await loaded()
  await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
  const r = root$()
  assert.equal(idx(), 1)
  await key(r, { code: 'ArrowRight' })
  assert.equal(idx(), 2)
  await key(r, { code: 'ArrowLeft' })
  assert.equal(idx(), 1)
  await key(r, { code: 'ArrowRight', altKey: true })           // next LINE: "Para cada fonte de contato"
  assert.equal(focalWord(), 'Para')
  await key(r, { code: 'ArrowRight', altKey: true })           // next line: first list item
  assert.equal(focalWord(), 'Nome')
  await key(r, { code: 'ArrowLeft', altKey: true })           // at a line start -> previous line
  assert.equal(focalWord(), 'Para')
  await key(r, { code: 'Home' })
  assert.equal(idx(), 1)
  const before = speed()
  await key(r, { key: ']', code: 'BracketRight' })
  assert.equal(speed(), before + 20)
  await key(r, { key: '[', code: 'BracketLeft' }); await key(r, { key: '[', code: 'BracketLeft' })
  assert.equal(speed(), before - 20)
  assert.ok(!$('[role="dialog"]'))
  await key(r, { key: '?', code: 'Slash', shiftKey: true })
  assert.ok($('[role="dialog"]'), 'help opens')
  assert.match($('[role="dialog"]').textContent, /Previous \/ next line or list item/)
  assert.ok(!/Previous \/ next session/.test($('[role="dialog"]').textContent), 'no session keys in the panel')
  await key(r, { code: 'Escape' })
  assert.ok(!$('[role="dialog"]'), 'escape closes help')
  await key(r, { code: 'ArrowRight', ctrlKey: true })          // browser chords are not taken
  assert.equal(idx(), 1)
  await unmount()
})

test('panel: caption keeps the chat structure, bullets, split long word, item highlight and the position chip', async () => {
  await mount(Panel)
  await loaded()
  await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
  const cap = caption()
  assert.ok(cap, 'caption present')
  const bullets = [...cap.querySelectorAll('span.select-none')].map((s) => s.textContent)
  assert.deepEqual(bullets, ['1.', '2.', '3.'])
  assert.match(cap.textContent, /getUserNameFromSessionStoreFactoryXYZ/, 'split parts are glued back in the caption')
  // click a word in the 2nd item: its line gets the accent bar, the others stay transparent
  const nome = [...cap.querySelectorAll('span.cursor-pointer')].find((s) => s.textContent === 'Como')
  await click(nome)
  assert.equal(focalWord(), 'Como')
  const bars = [...cap.querySelectorAll('div')].filter((d) => d.style.borderLeft && d.style.borderLeft.includes('3px'))
  const active = bars.filter((d) => d.style.borderLeft.includes('var(--accent'))
  assert.equal(bars.length, 3); assert.equal(active.length, 1)
  assert.match(active[0].textContent, /Como os dados/)
  // chip above the focal word
  assert.match(text(), /item 2\/3/)
  assert.match(text(), /Para cada fonte de contato/)
  // outside the list there is no chip
  await key(root$(), { code: 'Home' })
  assert.ok(!/item \d\/\d/.test(text()))
  await unmount()
})

test('panel: remaining time, play, resume rewind, ramp, manual jump cancels the rewind', async () => {
  await mount(Panel)
  await loaded()
  await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
  assert.match(text(), /· \d+:\d\d left/)
  for (let i = 0; i < 40; i++) await key(root$(), { key: ']', code: 'BracketRight' })
  assert.equal(speed(), 1000)
  await key(root$(), { code: 'Space' })                         // play
  await waitFor(() => idx() >= 8, 6000, 'playing advanced')
  await key(root$(), { code: 'Space' })                         // pause
  const paused = idx()
  await sleep(300)
  assert.equal(idx(), paused, 'really paused')
  await key(root$(), { code: 'Space' })                         // resume -> goes back 4 words
  assert.equal(idx(), Math.max(1, paused - 4), 'rewound on resume')
  await key(root$(), { code: 'Space' })                         // pause again
  const p2 = idx()
  await key(root$(), { code: 'ArrowRight' })                    // deliberate move
  await key(root$(), { code: 'Space' })                         // resume: NO rewind
  assert.equal(idx(), p2 + 1)
  await key(root$(), { code: 'Space' })
  await unmount()
})

test('panel: remembered position — resume notice, start over', async () => {
  await mount(Panel)
  await loaded()
  await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
  const cap = caption()
  const mid = [...cap.querySelectorAll('span.cursor-pointer')].find((s) => s.textContent === 'palavra30')
  await click(mid)
  await act(async () => { await sleep(2400) })                  // the 2s save interval
  const saved = JSON.parse(w.localStorage.getItem('rsvp-reader:positions'))
  const keys = Object.keys(saved)
  assert.equal(keys.length, 1)
  assert.match(keys[0], /^dashboard_chat-7-1000:3$/)            // canonical session id, not the URL key
  assert.ok(saved[keys[0]].f > 0.4 && saved[keys[0]].f < 0.95)
  await unmount()
  w.localStorage.setItem('rsvp-reader:view', 'all')
  await mount(Panel)
  await loaded()
  await choose(picker(), '3')
  await waitFor(() => /Picked up where you left off/.test(text()), 3000, 'resume notice')
  assert.equal(focalWord().startsWith('palavra'), true)
  await click(btn('Start over'))
  assert.ok(!/Picked up/.test(text()))
  assert.equal(idx(), 1)
  assert.equal(w.localStorage.getItem('rsvp-reader:positions'), '{}')
  await unmount()
})

test('panel: a new reply shows a banner after the conversation goes quiet; "Read it" opens it', async () => {
  const original = fs.readFileSync(SESS, 'utf8')
  try {
    await mount(Panel)
    await loaded()
    assert.ok(!/New reply/.test(text()))
    await sleep(700) // let the poller take its baseline reading before the file changes
    fs.appendFileSync(SESS, JSON.stringify({ role: 'assistant', content: 'Resposta nova que chegou depois.', ts: '2026-10-07T13:30:00+00:00' }) + '\n')
    await waitFor(() => /New reply in this conversation/.test(text()), 16000, 'new reply banner')
    await click(btn('Read it'))
    await waitFor(() => picker().value === '6', 3000, 'new reply selected')
    assert.ok(!/New reply/.test(text()))
    await waitFor(() => /Resposta/.test(focalWord()), 3000, 'new reply tokens')
    assert.deepEqual(options(), ['6', '4', '3', '0'])           // 5 stopped being a closing reply
  } finally {
    fs.writeFileSync(SESS, original)
    try { await unmount() } catch { /* already gone */ }
  }
})

test('panel: paste text, then back to the conversation', async () => {
  await mount(Panel)
  await loaded()
  await click(btn('Paste text instead'))
  const ta = $('textarea')
  const setValue = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { setValue.call(ta, 'Texto colado aqui para ler.'); ta.dispatchEvent(new w.Event('input', { bubbles: true })) })
  await key(ta, { key: 'Enter', ctrlKey: true })
  await waitFor(() => /Texto/.test(focalWord()), 3000, 'pasted text tokens')
  assert.ok(btn('Back to this conversation'))
  assert.ok(!picker(), 'picker hidden while pasted text is shown')
  await sleep(100)
  await click(btn('Back to this conversation'))
  await waitFor(() => picker() && picker().value === '5', 3000, 'back to the conversation')
  await unmount()
})

test('panel: settings — new rows, display block persists, escape closes, reset', async () => {
  await mount(Panel)
  await loaded()
  await click(btn('Settings'))
  assert.match(text(), /Reading display/)
  assert.match(text(), /Long words/)
  assert.match(text(), /Numbers \/ IDs/)
  assert.match(text(), /item start/)
  const font = $('select[aria-label="Focal word font"]')
  await choose(font, 'sans')
  assert.equal(JSON.parse(w.localStorage.getItem('rsvp-reader:display')).font, 'sans')
  const orp = $('input[aria-label="orp"]')
  await act(async () => { orp.value = '45'; orp.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })) })
  assert.equal(JSON.parse(w.localStorage.getItem('rsvp-reader:display')).orp, 45)
  const ramp = $('input[aria-label="Slow start after play"]')
  await click(ramp)
  assert.equal(JSON.parse(w.localStorage.getItem('rsvp-reader:display')).ramp, false)
  await key(root$(), { code: 'Escape' })
  assert.ok(!/Reading display/.test(text()), 'escape closes settings')
  // the focal word now uses the sans font
  assert.match($('span.relative').className, /font-sans/)
  await click(btn('Settings'))
  await click(btn('Reset to defaults'))
  assert.deepEqual(JSON.parse(w.localStorage.getItem('rsvp-reader:display')), core.DISPLAY_DEFAULTS)
  await unmount()
})

test('panel: split & hard-token settings reach the backend', async () => {
  await mount(Panel)
  await loaded()
  await click(btn('Settings'))
  const sel = $$('select').find((s) => [...s.options].some((o) => o.value === 'off') && [...s.options].some((o) => o.textContent === 'Keep whole'))
  await choose(sel, 'off')
  assert.equal(JSON.parse(w.localStorage.getItem('rsvp-reader:clean-settings')).split_long, 'off')
  await click(btn('Back to reader'))
  await choose(picker(), '3')
  await waitFor(() => calls.some((c) => c[1].includes('split_long') || decodeURIComponent(c[1]).includes('"split_long":"off"')), 3000, 'tokens requested with split off')
  await waitFor(() => /getUserNameFromSessionStoreFactoryXYZ/.test(caption().textContent), 3000, 'long word whole')
  await unmount()
})

test('page: session picker, message picker, Shift+↓ steps sessions, shortcuts row', async () => {
  await mount(Page)
  await waitFor(() => $('select[aria-label="Session to read"]') && $('select[aria-label="Session to read"]').options.length > 2, 4000, 'sessions')
  const sp = $('select[aria-label="Session to read"]')
  await choose(sp, 'dashboard_chat-7-1000')
  await waitFor(() => picker() && $('button[aria-label="Play"]'), 4000, 'page loaded')
  assert.deepEqual(options(), ['5', '4', '3', '0'])
  assert.match(text(), /4 of 5 messages/)
  assert.match(text(), /Alt\+←\/→/)
  assert.match(text(), /Shift\+↑\/↓/)
  await key(root$(), { code: 'ArrowDown', shiftKey: true })       // next session in the list
  await waitFor(() => sp.value === 'dashboard_chat-8-2000' || sp.value === 'dashboard_chat-7-1000', 2000, 'session step')
  await unmount()
})

test('chip: quick read plays the latest reply inside the popover; side panel stays first', async () => {
  let closed = false
  await mount(Chip, { session: { sessionKey: 'dashboard:chat-7-1000' }, onClose: () => { closed = true } })
  await waitFor(() => !/Checking/.test(text()), 3000, 'status')
  const order = $$('button').map((b) => b.textContent)
  assert.equal(order[0], 'Open in side panel')
  assert.deepEqual(order.slice(1), ['Quick read here', 'Open full page', 'Close'])
  await click(btn('Quick read here'))
  await waitFor(() => $('button[aria-label="Play"]'), 4000, 'mini reader loaded')
  assert.match(focalWord(), /De|nada|,/)
  await click(btn('Play'))
  await waitFor(() => $('button[aria-label="Pause"]'), 1000, 'playing')
  await click(btn('Pause'))
  await click(btn('Hide quick read'))
  assert.ok(!$('button[aria-label="Play"]'))
  await click(btn('Open full page'))
  assert.match(navigations.at(-1), /^\/apps\/rsvp-reader\?session=dashboard%3Achat-7-1000$/)
  assert.ok(closed)
  await unmount()
})

test('tips card is shown once and "Got it" is remembered', async () => {
  await mount(Panel)
  await loaded()
  assert.match(text(), /Quick tour/)
  await click(btn('Got it'))
  assert.ok(!/Quick tour/.test(text()))
  await unmount()
  await mount(Panel)
  await loaded()
  assert.ok(!/Quick tour/.test(text()))
  await unmount()
})

test('ramp-up: the first words after Play are slower than the rest (and the setting turns it off)', async () => {
  async function timeFiveWords(ramp) {
    w.localStorage.clear()
    w.localStorage.setItem('rsvp-reader:display', JSON.stringify({ ...core.DISPLAY_DEFAULTS, ramp }))
    w.localStorage.setItem('rsvp-reader:wpm', '1000')
    w.localStorage.setItem('rsvp-reader:tips-seen', '1')
    await mount(Panel)
    await loaded()
    await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
    // start from "palavra0" in the middle of the plain words (no pauses there)
    const cap = caption()
    await click([...cap.querySelectorAll('span.cursor-pointer')].find((s) => s.textContent === 'palavra10'))
    const start = idx()
    const t0 = Date.now()
    await key(root$(), { code: 'Space' })
    await waitFor(() => idx() >= start + 5, 4000, 'five words')
    const ms = Date.now() - t0
    await key(root$(), { code: 'Space' })
    await unmount()
    return ms
  }
  const slow = await timeFiveWords(true)
  const fast = await timeFiveWords(false)
  assert.ok(slow > fast * 1.2, `ramp on ${slow}ms vs off ${fast}ms`)
})

test('page: a slow answer for a session we already left does not overwrite the current one', async () => {
  const realGet = api.get
  api.get = async (path) => {
    const r = await realGet(path)
    if (path.includes('dashboard_chat-8-2000/messages?')) await sleep(900)   // the OLD session answers late
    return r
  }
  try {
    await mount(Page)
    await waitFor(() => $('select[aria-label="Session to read"]') && $('select[aria-label="Session to read"]').options.length > 2, 4000, 'sessions')
    const sp = $('select[aria-label="Session to read"]')
    await choose(sp, 'dashboard_chat-8-2000')                      // slow one
    await choose(sp, 'dashboard_chat-7-1000')                      // the one we really want
    await waitFor(() => picker() && picker().value === '5', 4000, 'session 7 loaded')
    await act(async () => { await sleep(1200) })                   // let the stale answer arrive
    assert.deepEqual(options(), ['5', '4', '3', '0'], 'still showing session 7')
  } finally {
    api.get = realGet
    await unmount()
  }
})

test('the [OPTIONS: ...] line is not read by default and can be turned on in Settings', async () => {
  await mount(Panel)
  await loaded()
  await choose(picker(), '3'); await waitFor(() => /Resumo/.test(focalWord()), 3000, 'message 3')
  assert.ok(!/OPTIONS|Escolha/.test(caption().textContent), 'skipped by default')
  const last = [...caption().querySelectorAll('span.cursor-pointer')].at(-1)
  assert.match(last.textContent, /palavra59/, 'the reading ends at the real last word')
  await click(btn('Settings'))
  const sel = $$('select').find((s) => [...s.options].some((o) => o.textContent === 'Read them'))
  assert.equal(sel.value, 'hide')
  await choose(sel, 'read')
  assert.equal(JSON.parse(w.localStorage.getItem('rsvp-reader:clean-settings')).options, 'read')
  await click(btn('Back to reader'))
  await waitFor(() => /Options:/.test(caption().textContent) && /Escolha/.test(caption().textContent), 3000, 'options read')
  await unmount()
})
