// Run: node --test ui/tests/pure.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
  },
}
const P = await import('../pure.mjs')

const tok = (text, extra = {}) => ({ text, mult: 1, messageIndex: 0, breakBefore: 0, isSentenceEnd: false, ...extra })

test('rampFactor: slower at first, back to 1 after the ramp', () => {
  const f = [0, 1, 2, 3, 4, 5, 9].map((k) => P.rampFactor(k))
  assert.deepEqual(f.map((x) => Math.round(x * 100) / 100), [1.9, 1.72, 1.54, 1.36, 1.18, 1, 1])
  assert.equal(P.rampFactor(-1), 1)
  assert.equal(P.rampFactor(NaN), 1)
  assert.ok(P.rampFactor(0, 10) === 1.9 && P.rampFactor(5, 10) > 1)
})

test('rewindIndex never goes below 0 and ignores junk', () => {
  assert.equal(P.rewindIndex(10, 4), 6)
  assert.equal(P.rewindIndex(2, 4), 0)
  assert.equal(P.rewindIndex(10, 0), 10)
  assert.equal(P.rewindIndex(10, -3), 10)
})

test('line navigation follows the backend line starts', () => {
  const t = [
    tok('A'), tok('b'), tok('c'),
    tok('D', { breakBefore: 2 }), tok('e'),
    tok('F', { breakBefore: 1 }), tok('g'), tok('h'),
    tok('Z', { messageIndex: 1 }), tok('y'),
  ]
  assert.equal(P.nextLineIndex(t, 0, 1), 3)
  assert.equal(P.nextLineIndex(t, 4, 1), 5)
  assert.equal(P.nextLineIndex(t, 7, 1), 8)          // next message starts a line too
  assert.equal(P.nextLineIndex(t, 9, 1), 9)          // last line: stays at the end
  assert.equal(P.nextLineIndex(t, 7, -1), 5)         // inside a line -> its start
  assert.equal(P.nextLineIndex(t, 5, -1), 3)         // at a start -> previous line
  assert.equal(P.nextLineIndex(t, 1, -1), 0)
  assert.equal(P.nextLineIndex(t, 0, -1), 0)
  assert.equal(P.nextLineIndex([], 0, 1), 0)
})

test('remaining time uses the real pause multipliers and the current speed', () => {
  const t = [tok('a'), tok('b', { mult: 2.4 }), tok('c'), tok('d')]
  const cum = P.cumulativeMults(t)
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`)
  near(P.remainingMs(cum, 0, 60), (1 + 2.4 + 1 + 1) * 1000)
  near(P.remainingMs(cum, 2, 60), 2000)
  assert.equal(P.remainingMs(cum, 4, 60), 0)
  assert.equal(P.remainingMs(cum, 99, 60), 0)
  assert.equal(P.remainingMs(P.cumulativeMults([]), 0, 300), 0)
  near(P.remainingMs(cum, 0, 120), 5.4 * 500)
})

test('formatDuration', () => {
  assert.equal(P.formatDuration(0), '0:00')
  assert.equal(P.formatDuration(42_000), '0:42')
  assert.equal(P.formatDuration(72_000), '1:12')
  assert.equal(P.formatDuration(3_725_000), '1:02:05')
  assert.equal(P.formatDuration(-5), '0:00')
})

test('readMinutesLabel', () => {
  assert.equal(P.readMinutesLabel(30, 320), '<1 min')
  assert.equal(P.readMinutesLabel(320, 320), '~1 min')
  assert.equal(P.readMinutesLabel(1600, 320), '~5 min')
  assert.equal(P.readMinutesLabel(5000, 0), '~5000 min') // wpm 0 cannot divide by zero
})

test('formatMessageTime: today shows the hour, other days the date too, junk shows nothing', () => {
  const now = new Date(2026, 9, 7, 15, 0)
  assert.equal(P.formatMessageTime(new Date(2026, 9, 7, 9, 5).toISOString(), now), '09:05')
  assert.equal(P.formatMessageTime(new Date(2026, 9, 6, 14, 32).toISOString(), now), '06/10 14:32')
  assert.equal(P.formatMessageTime('not a date', now), '')
  assert.equal(P.formatMessageTime(null, now), '')
})

test('orpSplit honours the ratio, clamps it and keeps trailing punctuation', () => {
  assert.deepEqual(P.orpSplit('reading,'), { before: 're', orp: 'a', after: 'ding,' })
  assert.deepEqual(P.orpSplit('reading', 0.5), { before: 'rea', orp: 'd', after: 'ing' })
  assert.equal(P.orpSplit('reading', 0.2).before, 'r')
  assert.equal(P.orpSplit('ab', 5).orp, 'b')           // clamped to 0.9
  assert.equal(P.orpSplit('x', NaN).orp, 'x')
  assert.equal(P.orpSplit('').orp, '')
})

test('fitFontPx scales a too-wide word down and never up', () => {
  assert.equal(P.fitFontPx(100, 0, 0), 100)
  assert.equal(P.fitFontPx(100, 500, 400), 100)
  assert.equal(P.fitFontPx(100, 224, 400), 50)   // (224 - 24) / 400
  assert.equal(P.fitFontPx(10, 30, 4000), 6)
})

test('positions: only mid-message positions are kept, finished ones are forgotten', () => {
  store.clear()
  const k = P.positionKey('dashboard_chat-1', 7)
  assert.equal(P.getPosition(k), null)
  P.savePosition(k, 0.4)
  assert.equal(P.getPosition(k), 0.4)
  P.savePosition(k, 0.01)                 // back at the start -> nothing to resume
  assert.equal(P.getPosition(k), null)
  P.savePosition(k, 0.5)
  P.savePosition(k, 0.98)                 // finished -> forgotten
  assert.equal(P.getPosition(k), null)
  P.savePosition(k, 0.5)
  P.clearPosition(k)
  assert.equal(P.getPosition(k), null)
  P.savePosition(k, NaN); P.savePosition('', 0.5)   // junk is ignored
  assert.equal(P.getPosition(k), null)
})

test('positions: prunes the oldest beyond the cap', () => {
  store.clear()
  for (let i = 0; i < P.POSITIONS_MAX + 25; i++) P.savePosition(`s:${i}`, 0.5, 1000 + i)
  const all = JSON.parse(store.get(P.POSITIONS_KEY))
  assert.equal(Object.keys(all).length, P.POSITIONS_MAX)
  assert.ok(!('s:0' in all) && ('s:' + (P.POSITIONS_MAX + 24) in all))
})

test('positions: corrupt storage never throws', () => {
  store.set(P.POSITIONS_KEY, '{not json')
  assert.equal(P.getPosition('x'), null)
  P.savePosition('x', 0.5)
  assert.equal(P.getPosition('x'), 0.5)
  store.set(P.POSITIONS_KEY, '[1,2]')
  assert.equal(P.getPosition('x'), null)
})

test('message list helpers', () => {
  const list = [
    { index: 9, role: 'assistant', final: true },
    { index: 8, role: 'assistant', final: false },
    { index: 7, role: 'user', final: true },
    { index: 5, role: 'assistant', final: true },
    { index: 4, role: 'assistant' },            // old backend: no flag -> counts as final
  ]
  assert.deepEqual(P.visibleMessages(list, 'final').map((m) => m.index), [9, 7, 5, 4])
  assert.equal(P.visibleMessages(list, 'all').length, 5)
  assert.equal(P.pickDefaultMessage(list).index, 9)
  assert.equal(P.pickDefaultMessage([{ index: 1, role: 'user' }]).index, 1)
  assert.equal(P.pickDefaultMessage([]), null)
  const vis = P.visibleMessages(list, 'final')
  assert.equal(P.stepInList(vis, 9, 1), 7)
  assert.equal(P.stepInList(vis, 4, 1), null)    // stops at the end
  assert.equal(P.stepInList(vis, 9, -1), null)   // and at the start
  assert.equal(P.stepInList(vis, 8, 1), null)    // current message not in the list
  assert.equal(P.newestFinalAssistant(list).index, 9)
  assert.equal(P.newestFinalAssistant([{ index: 1, role: 'user' }]), null)
})

test('keyAction', () => {
  const k = (o) => P.keyAction({ code: '', key: '', ...o })
  assert.equal(k({ code: 'Space' }), 'toggle')
  assert.equal(k({ code: 'ArrowRight' }), 'wordNext')
  assert.equal(k({ code: 'ArrowRight', shiftKey: true }), 'sentenceNext')
  assert.equal(k({ code: 'ArrowRight', altKey: true }), 'lineNext')
  assert.equal(k({ code: 'ArrowLeft', altKey: true }), 'linePrev')
  assert.equal(k({ code: 'ArrowUp' }), 'messagePrev')
  assert.equal(k({ code: 'ArrowDown', shiftKey: true }), 'sessionNext')
  assert.equal(k({ code: 'Home' }), 'restart')
  assert.equal(k({ code: 'Escape' }), 'escape')
  assert.equal(k({ key: '[' }), 'slower')
  assert.equal(k({ key: '-' }), 'slower')
  assert.equal(k({ key: ']' }), 'faster')
  assert.equal(k({ key: '=' }), 'faster')
  assert.equal(k({ key: '?' }), 'help')
  assert.equal(k({ key: 'a' }), null)
  assert.equal(k({ code: 'Space', ctrlKey: true }), null)   // browser chords stay the browser's
  assert.equal(k({ key: '=', metaKey: true }), null)
})

test('clampWpm', () => {
  assert.equal(P.clampWpm(5), P.MIN_WPM)
  assert.equal(P.clampWpm(5000), P.MAX_WPM)
  assert.equal(P.clampWpm(333.4), 333)
})

test('display settings: defaults, clamping, junk', () => {
  assert.deepEqual(P.sanitizeDisplay(null), P.DISPLAY_DEFAULTS)
  const d = P.sanitizeDisplay({ font: 'sans', spacing: 9, orp: 5, rewind: 3.4, ramp: false, extra: 1 })
  assert.deepEqual(d, { font: 'sans', spacing: 0.2, orp: 20, rewind: 3.4, ramp: false })
  assert.equal(P.sanitizeDisplay({ font: 'comic' }).font, 'mono')
  assert.equal(P.sanitizeDisplay({ orp: 'x' }).orp, 35)
  assert.equal(P.sanitizeDisplay({ orp: null }).orp, 35)
  store.set(P.DISPLAY_KEY, '{bad')
  assert.deepEqual(P.loadStoredDisplay(), P.DISPLAY_DEFAULTS)
})

test('stored wpm and focal height are clamped', () => {
  store.set(P.WPM_STORAGE_KEY, '99999'); assert.equal(P.loadStoredWpm(), P.MAX_WPM)
  store.set(P.WPM_STORAGE_KEY, 'abc'); assert.equal(P.loadStoredWpm(), P.WPM_DEFAULT)
  store.set(P.FOCAL_HEIGHT_STORAGE_KEY, '1'); assert.equal(P.loadStoredFocalHeight(), P.FOCAL_HEIGHT_MIN)
})
