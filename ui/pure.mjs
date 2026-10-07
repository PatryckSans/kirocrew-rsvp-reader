// RSVP Reader — pure logic, no React and no DOM beyond localStorage. Everything
// here is unit-tested in Node (ui/tests/pure.test.mjs); rsvp-core.mjs re-exports
// it, so the page and the panel import from one place.

// ---------- speed ----------

export const MIN_WPM = 100
export const MAX_WPM = 1000
export const WPM_DEFAULT = 320
export const WPM_STORAGE_KEY = 'rsvp-reader:wpm'
export const WPM_KEY_STEP = 20

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export function loadStoredWpm() {
  try {
    const raw = storage() && storage().getItem(WPM_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n)) return Math.max(MIN_WPM, Math.min(MAX_WPM, n))
  } catch {
    // localStorage unavailable (private mode, restricted iframe) -- use the default.
  }
  return WPM_DEFAULT
}

export function clampWpm(wpm) {
  return Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(wpm)))
}

export function stepDurationMs(wpm, token) {
  const base = 60000 / wpm
  return base * (token ? token.mult : 1)
}

// ---------- ramp-up after pressing play ----------

export const RAMP_STEPS = 5
const RAMP_EXTRA = 0.9

// k = how many words went by since play was pressed. The first words are slower
// (x1.9 → x1.18) so the eye can lock on before the full speed kicks in.
export function rampFactor(k, steps = RAMP_STEPS) {
  if (!(k >= 0) || k >= steps) return 1
  return 1 + RAMP_EXTRA * (steps - k) / steps
}

// ---------- navigation ----------

export function clampIndex(tokens, index) {
  if (tokens.length === 0) return 0
  return Math.max(0, Math.min(tokens.length - 1, index))
}

export function nextSentenceIndex(tokens, index, dir) {
  let i = index
  const n = tokens.length
  do {
    i += dir
  } while (i > 0 && i < n - 1 && !(tokens[i - dir] && tokens[i - dir].isSentenceEnd))
  return clampIndex(tokens, i)
}

// A "line" is what the chat shows on its own line: a paragraph, a list item, a
// heading, a table row. The backend marks the first token of each one.
export function isLineStart(tokens, i) {
  if (i <= 0) return true
  const t = tokens[i]
  return (t.breakBefore || 0) > 0 || t.messageIndex !== tokens[i - 1].messageIndex
}

export function lineStartIndex(tokens, index) {
  let i = Math.max(0, Math.min(tokens.length - 1, index))
  while (i > 0 && !isLineStart(tokens, i)) i--
  return i
}

// Alt+→ / Alt+←: next line start / the start of this line (or the previous one
// when already at the start).
export function nextLineIndex(tokens, index, dir) {
  const n = tokens.length
  if (!n) return 0
  if (dir > 0) {
    for (let i = index + 1; i < n; i++) if (isLineStart(tokens, i)) return i
    return n - 1
  }
  const s = lineStartIndex(tokens, index)
  if (s < index) return s
  return s === 0 ? 0 : lineStartIndex(tokens, s - 1)
}

// Where to go back to when playback resumes after a pause.
export function rewindIndex(index, words) {
  return Math.max(0, index - Math.max(0, words | 0))
}

// ---------- time ----------

export function cumulativeMults(tokens) {
  const cum = new Float64Array(tokens.length + 1)
  for (let i = 0; i < tokens.length; i++) cum[i + 1] = cum[i] + (tokens[i].mult || 1)
  return cum
}

export function remainingMs(cum, index, wpm) {
  const n = cum.length - 1
  if (n <= 0) return 0
  const i = Math.max(0, Math.min(n, index))
  return (cum[n] - cum[i]) * 60000 / wpm
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const hrs = Math.floor(total / 3600)
  const pad = (x) => String(x).padStart(2, '0')
  return hrs > 0 ? `${hrs}:${pad(m)}:${pad(s)}` : `${Math.floor(total / 60)}:${pad(s)}`
}

export function readMinutesLabel(words, wpm) {
  const minutes = words / Math.max(1, wpm)
  if (minutes < 0.75) return '<1 min'
  return `~${Math.round(minutes)} min`
}

// "14:32" for today, "06/10 14:32" for another day. Empty when the timestamp is unusable.
export function formatMessageTime(ts, now = new Date()) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (x) => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return same ? hm : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`
}

// ---------- the focal word ----------

export const ORP_DEFAULT = 0.35

export function orpSplit(word, ratio = ORP_DEFAULT) {
  const clean = word.replace(/[.,;:!?]+$/, '')
  const suffix = word.slice(clean.length)
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(0.9, ratio)) : ORP_DEFAULT
  const orpIdx = Math.max(0, Math.floor(clean.length * r))
  return {
    before: clean.slice(0, orpIdx),
    orp: clean[orpIdx] || '',
    after: clean.slice(orpIdx + 1) + suffix,
  }
}

// Horizontal breathing room kept on each side of the focal word.
export const FOCAL_SIDE_PADDING_PX = 12

// Largest font <= baseFontPx such that a word that measured `measuredWidth` px at
// baseFontPx fits inside `containerWidth` (minus padding). Width scales linearly
// with font size, so a single ratio is exact. Falls back to the base size until
// both measurements are available.
export function fitFontPx(baseFontPx, containerWidth, measuredWidth) {
  if (!containerWidth || !measuredWidth) return baseFontPx
  const avail = Math.max(1, containerWidth - FOCAL_SIDE_PADDING_PX * 2)
  if (measuredWidth <= avail) return baseFontPx
  return Math.max(6, Math.floor(baseFontPx * (avail / measuredWidth)))
}

export const FOCAL_HEIGHT_MIN = 160
export const FOCAL_HEIGHT_MAX = 640
export const FOCAL_HEIGHT_DEFAULT = 300
export const FOCAL_HEIGHT_STORAGE_KEY = 'rsvp-reader:focal-height'

export function loadStoredFocalHeight() {
  try {
    const raw = storage() && storage().getItem(FOCAL_HEIGHT_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    if (Number.isFinite(n)) return Math.max(FOCAL_HEIGHT_MIN, Math.min(FOCAL_HEIGHT_MAX, n))
  } catch {
    // localStorage unavailable (private mode, restricted iframe) -- use the default.
  }
  return FOCAL_HEIGHT_DEFAULT
}

// ---------- reading position, remembered per message ----------

export const POSITIONS_KEY = 'rsvp-reader:positions'
export const POSITIONS_MAX = 200

export function positionKey(sessionId, messageIndex) {
  return `${sessionId}:${messageIndex}`
}

function readPositions() {
  try {
    const raw = storage() && storage().getItem(POSITIONS_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}

function writePositions(all) {
  try { if (storage()) storage().setItem(POSITIONS_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}

// Only a position that is clearly "in the middle" is worth restoring: before 2%
// there is nothing to resume, and from 97% on the message counts as read.
export function isRestorable(frac) {
  return typeof frac === 'number' && frac >= 0.02 && frac < 0.97
}

export function getPosition(key) {
  const p = readPositions()[key]
  return p && isRestorable(p.f) ? p.f : null
}

export function savePosition(key, frac, now = Date.now()) {
  if (!key || !Number.isFinite(frac)) return
  const all = readPositions()
  if (!isRestorable(frac)) {
    if (key in all) { delete all[key]; writePositions(all) }
    return
  }
  all[key] = { f: Math.round(frac * 1000) / 1000, t: now }
  const keys = Object.keys(all)
  if (keys.length > POSITIONS_MAX) {
    keys.sort((a, b) => (all[a].t || 0) - (all[b].t || 0))
    for (const k of keys.slice(0, keys.length - POSITIONS_MAX)) delete all[k]
  }
  writePositions(all)
}

export function clearPosition(key) {
  const all = readPositions()
  if (key in all) { delete all[key]; writePositions(all) }
}

// ---------- message list ----------

export const VIEW_KEY = 'rsvp-reader:view'

// 'final' = the closing assistant message of each turn (+ your own messages);
// 'all' = everything, including the narration between tool calls.
export function visibleMessages(messages, view) {
  if (view !== 'final') return messages
  return messages.filter((m) => m.final !== false)
}

// `messages` is most-recent-first. The default is the newest assistant message.
export function pickDefaultMessage(list) {
  return list.find((m) => m.role === 'assistant') || list[0] || null
}

export function stepInList(list, currentIndex, dir) {
  const pos = list.findIndex((m) => m.index === currentIndex)
  if (pos === -1) return null
  const next = pos + dir
  if (next < 0 || next >= list.length) return null
  return list[next].index
}

// Newest closing assistant message, or null.
export function newestFinalAssistant(messages) {
  return messages.find((m) => m.role === 'assistant' && m.final !== false) || null
}

// ---------- keyboard ----------

// Maps a keydown to an action name (null = not ours). Ctrl/Cmd chords are never
// taken, so the browser's own shortcuts keep working.
export function keyAction(e) {
  if (e.ctrlKey || e.metaKey) return null
  switch (e.code) {
    case 'Space': return 'toggle'
    case 'ArrowRight': return e.altKey ? 'lineNext' : e.shiftKey ? 'sentenceNext' : 'wordNext'
    case 'ArrowLeft': return e.altKey ? 'linePrev' : e.shiftKey ? 'sentencePrev' : 'wordPrev'
    case 'ArrowUp': return e.shiftKey ? 'sessionPrev' : 'messagePrev'
    case 'ArrowDown': return e.shiftKey ? 'sessionNext' : 'messageNext'
    case 'Home': return 'restart'
    case 'Escape': return 'escape'
    default: break
  }
  switch (e.key) {
    case '[': case '-': return 'slower'
    case ']': case '=': case '+': return 'faster'
    case '?': return 'help'
    default: return null
  }
}

export const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['← →', 'Previous / next word'],
  ['Shift + ← →', 'Previous / next sentence'],
  ['Alt + ← →', 'Previous / next line or list item'],
  ['↑ ↓', 'Previous / next message'],
  ['Shift + ↑ ↓', 'Previous / next session (full page only)'],
  ['[  ]   or   -  =', 'Slower / faster (20 WPM per press)'],
  ['Home', 'Back to the start'],
  ['Esc', 'Close settings, help or the paste box'],
  ['?', 'Show / hide this list'],
]

// ---------- display settings (look & feel of the reader) ----------

export const DISPLAY_KEY = 'rsvp-reader:display'

export const DISPLAY_DEFAULTS = {
  font: 'mono', // 'mono' | 'sans'
  spacing: 0, // letter spacing, em
  orp: 35, // % of the word where the highlighted letter sits
  rewind: 4, // words to step back when playback resumes after a pause
  ramp: true, // slower first words after pressing play
}

export const DISPLAY_LIMITS = {
  spacing: [0, 0.2, 0.01],
  orp: [20, 50, 1],
  rewind: [0, 12, 1],
}

export function sanitizeDisplay(raw) {
  const out = { ...DISPLAY_DEFAULTS }
  if (!raw || typeof raw !== 'object') return out
  if (raw.font === 'mono' || raw.font === 'sans') out.font = raw.font
  if (typeof raw.ramp === 'boolean') out.ramp = raw.ramp
  for (const [key, [lo, hi]] of Object.entries(DISPLAY_LIMITS)) {
    const v = Number(raw[key])
    if (raw[key] !== null && raw[key] !== '' && Number.isFinite(v)) out[key] = Math.max(lo, Math.min(hi, v))
  }
  return out
}

export function loadStoredDisplay() {
  try {
    const raw = storage() && storage().getItem(DISPLAY_KEY)
    if (raw) return sanitizeDisplay(JSON.parse(raw))
  } catch {
    // unavailable or corrupt -- defaults
  }
  return { ...DISPLAY_DEFAULTS }
}
