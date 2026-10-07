// RSVP Reader — shared display components, used by both the full page
// (index.mjs) and the side-panel tab (panel.mjs). The framework-free logic lives
// in pure.mjs (unit-tested in Node) and the stateful hooks in player.mjs; this
// file holds what is drawn.
//
// window.__kirocrew_modules is the import map the host injects: react resolves
// from here, never from node_modules (same convention as index.mjs).

const React = window.__kirocrew_modules.react
const {
  useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, memo, Fragment, createElement: h,
} = React

import {
  MIN_WPM, MAX_WPM, orpSplit, fitFontPx, DISPLAY_DEFAULTS, DISPLAY_LIMITS, DISPLAY_KEY,
  sanitizeDisplay, loadStoredDisplay, VIEW_KEY, visibleMessages, formatMessageTime, readMinutesLabel,
  SHORTCUTS,
} from './pure.mjs'

// Everything the other modules used to import from here keeps working.
export * from './pure.mjs'

// ---------- tiny DOM helpers ----------

// Focus ring for keyboard users. Injected once: this app cannot add Tailwind
// classes to the host's stylesheet, and the host does not ring custom controls.
const STYLE_ID = 'rsvp-reader-style'
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = '.rsvp-focusable:focus-visible{outline:2px solid var(--accent, currentColor);outline-offset:2px}'
  document.head.appendChild(el)
}
ensureStyles()

export function prefersReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { return false }
}

export function isPlaceholder(token) {
  return !!token && !!token.kind && token.kind !== 'word'
}

export function RsvpDisplay({ token, height, onResizeStart, hideHandle, display }) {
  const look = display || DISPLAY_DEFAULTS
  const fontClass = look.font === 'sans' ? 'font-sans' : 'font-mono'
  const spacingStyle = look.spacing > 0 ? { letterSpacing: `${look.spacing}em` } : null
  // The font derives from the adjustable height: ~46% of the focal box height
  // renders a word that fills the space well without overflowing vertically.
  const focalFontPx = Math.round(height * 0.46)
  const focalFont = `${focalFontPx}px`

  // Live container width (ResizeObserver) + width of the current word at the
  // base font size; both feed fitFontPx() below.
  const containerRef = useRef(null)
  const measureRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [measuredWidth, setMeasuredWidth] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    setContainerWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [token === null || token === undefined])

  const wordText = token ? token.text : ''
  useLayoutEffect(() => {
    if (measureRef.current) setMeasuredWidth(measureRef.current.offsetWidth)
  }, [wordText, focalFontPx, look.font, look.spacing])

  const resizeHandle = h('div', {
    className: 'absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-2.5 rounded-t-md ' +
      'bg-border hover:bg-accent cursor-ns-resize flex items-center justify-center',
    style: { transform: 'translateX(-50%)' },
    title: 'Drag to adjust the focal word size',
    role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Focal word size (drag)',
    onMouseDown: onResizeStart,
    onTouchStart: onResizeStart,
  },
    h('div', { className: 'w-8 h-[3px] rounded-full bg-card' }),
  )

  const handle = hideHandle ? null : resizeHandle

  if (!token) {
    return h('div', {
      ref: containerRef,
      className: 'relative flex items-center justify-center rounded-t-2xl bg-bg-elevated select-none w-full min-w-0',
      style: { height: `${height}px` },
    },
      h('span', { className: 'font-semibold text-text-strong ' + fontClass, style: { fontSize: focalFont } }, 'End'),
      handle,
    )
  }
  const { before, orp, after } = orpSplit(token.text, look.orp / 100)
  // The font must fit the ACTUAL container width (the side panel is far
  // narrower than the full page), so instead of guessing from the word length
  // we measure: a hidden twin of the word is rendered at the base size, its
  // real pixel width is read, and the visible word is scaled down to fit.
  const fontPx = fitFontPx(focalFontPx, containerWidth, measuredWidth)
  return h('div', {
    ref: containerRef,
    className: 'relative flex items-center justify-center rounded-t-2xl bg-bg-elevated overflow-hidden select-none w-full min-w-0',
    style: { height: `${height}px` },
  },
    h('div', {
      className: 'absolute left-1/2 top-0 bottom-0 w-px bg-border pointer-events-none',
      style: { transform: 'translateX(-0.5px)' },
    }),
    h('span', {
      ref: measureRef,
      'aria-hidden': 'true',
      className: 'absolute font-semibold tracking-tight whitespace-nowrap pointer-events-none ' + fontClass,
      style: { fontSize: focalFont, lineHeight: 1, visibility: 'hidden', left: 0, top: 0, ...spacingStyle },
    }, token.text),
    h('span', {
      // Placeholders ([code: py, 3 lines], [link: github.com]) are muted so they
      // read as "something was summarised here"; emphasised words are heavier.
      className: 'relative tracking-tight whitespace-nowrap ' + fontClass + ' ' +
        (isPlaceholder(token) ? 'font-semibold text-muted-strong' : 'text-text-strong ' + (token.emphasis ? 'font-extrabold' : 'font-semibold')),
      style: { fontSize: `${fontPx}px`, lineHeight: 1, fontWeight: token.emphasis ? 800 : undefined, ...spacingStyle },
    },
      before,
      h('span', { className: 'text-accent' }, orp),
      after,
    ),
    listChip(token),
    handle,
  )
}

// "3/8 · Para cada fonte de contato": where the focal word sits in a list (the
// number is always visible, the title is what gets ellipsised in a narrow panel).
// Inline styles on purpose: this app cannot add Tailwind classes to the host CSS.
function listChip(token) {
  if (!token || !token.listItem) return null
  const pos = `${token.listItem}${token.listSub ? '.' + token.listSub : ''}/${token.listSize}`
  return h('div', {
    'aria-hidden': 'true',
    style: {
      position: 'absolute', top: 8, left: 12, right: 12, display: 'flex', gap: 6, alignItems: 'baseline',
      fontSize: 11, lineHeight: 1.2, pointerEvents: 'none',
    },
  },
    h('span', { className: 'text-accent', style: { flexShrink: 0, fontWeight: 600, whiteSpace: 'nowrap' } }, `item ${pos}`),
    token.listTitle && h('span', {
      className: 'text-muted',
      style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    }, '\u00b7 ' + token.listTitle),
  )
}

const KBD = 'bg-bg-elevated border border-border rounded px-1.5 text-[10px]'

export function PlaybackControls({
  playing, wpm, pct, label, remaining, onTogglePlay, onPrev, onNext, onRestart, onWpmChange, onScrub, onHelp,
  compact, showSessionKeys,
}) {
  const handleTrackClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const p = (e.clientX - rect.left) / rect.width
    onScrub(Math.max(0, Math.min(1, p)))
  }
  const sq = (extra) => ({ width: '36px', height: '36px', ...extra })
  const iconBtn = 'rsvp-focusable shrink-0 inline-flex items-center justify-center rounded-[10px] border border-border bg-bg-elevated text-[15px] leading-none'
  return h('div', { className: 'rounded-b-2xl border border-t-0 border-border bg-card' },
    h('div', { className: compact ? 'px-3 pt-2' : 'px-5 pt-2.5' },
      h('div', {
        className: 'h-1 rounded-full bg-border cursor-pointer relative', onClick: handleTrackClick,
        role: 'progressbar', 'aria-label': 'Reading progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct,
      },
        h('div', { className: 'absolute top-0 left-0 h-full rounded-full bg-accent', style: { width: `${pct}%` } }),
      ),
      h('div', { className: 'flex justify-between gap-2 text-[11px] text-muted mt-1.5' },
        h('span', null, label, remaining ? ` · ${remaining} left` : ''), h('span', null, `${pct}%`),
      ),
    ),
    h('div', {
      className: compact
        ? 'flex flex-col items-stretch gap-2.5 px-3 py-3'
        : 'flex items-center gap-3.5 px-5 py-4',
    },
      h('div', { className: 'flex items-center gap-1.5 shrink-0 justify-center' },
        h('button', { className: iconBtn, style: sq(), title: 'Restart (Home)', 'aria-label': 'Restart from the beginning', onClick: onRestart }, '⟲'),
        h('button', { className: iconBtn, style: sq(), title: 'Previous word (←)', 'aria-label': 'Previous word', onClick: onPrev }, '⏮'),
        h('button', {
          className: 'rsvp-focusable shrink-0 inline-flex items-center justify-center rounded-[10px] bg-accent text-white text-[18px] leading-none',
          style: { width: '46px', height: '46px' },
          title: 'Play/Pause (Space)', 'aria-label': playing ? 'Pause' : 'Play', 'aria-pressed': playing, onClick: onTogglePlay,
        }, playing ? '⏸' : '▶'),
        h('button', { className: iconBtn, style: sq(), title: 'Next word (→)', 'aria-label': 'Next word', onClick: onNext }, '⏭'),
        onHelp && h('button', { className: iconBtn, style: sq(), title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onClick: onHelp }, '?'),
      ),
      h('div', { className: 'flex items-center gap-2.5 flex-1 min-w-0' },
        h('span', { className: 'text-[12px] text-muted-strong whitespace-nowrap' },
          'Speed: ', h('strong', { className: 'text-text-strong text-[13px]' }, wpm), ' WPM'),
        h('input', {
          type: 'range', min: MIN_WPM, max: MAX_WPM, step: 10, value: wpm,
          className: 'rsvp-focusable flex-1 min-w-0', onChange: (e) => onWpmChange(Number(e.target.value)),
          'aria-label': 'Reading speed in words per minute', 'aria-valuetext': `${wpm} words per minute`,
        }),
      ),
    ),
    !compact && h('div', { className: 'flex gap-3 flex-wrap px-5 pb-3.5 text-[11px] text-muted' },
      h('span', null, h('kbd', { className: KBD }, 'Space'), ' play/pause'),
      h('span', null, h('kbd', { className: KBD }, '←/→'), ' word'),
      h('span', null, h('kbd', { className: KBD }, 'Shift+←/→'), ' sentence'),
      h('span', null, h('kbd', { className: KBD }, 'Alt+←/→'), ' line / item'),
      h('span', null, h('kbd', { className: KBD }, '↑/↓'), ' message'),
      showSessionKeys && h('span', null, h('kbd', { className: KBD }, 'Shift+↑/↓'), ' session'),
      h('span', null, h('kbd', { className: KBD }, '[ ]'), ' speed'),
      h('span', null, h('kbd', { className: KBD }, '?'), ' all shortcuts'),
    ),
  )
}

// Context box. Tokens are grouped into the SAME lines the chat shows: the backend
// marks the first token of every source line (`breakBefore` 1 = new line, 2 = blank
// line) and what the line is (`lineKind`: heading, list item + bullet, quote, table
// row), so paragraphs, lists, headings and table rows are not squashed into one run.
const LINE_CLASS = {
  h: 'font-semibold text-text-strong',
  th: 'font-semibold text-text-strong border-l-2 border-border pl-2',
  tr: 'border-l-2 border-border pl-2',
  q: 'border-l-2 border-border pl-2',
}

export function groupLines(tokens) {
  const lines = []
  let prevMsg = null
  tokens.forEach((t, i) => {
    const newMsg = t.messageIndex !== prevMsg
    if (!lines.length || newMsg || t.breakBefore > 0) {
      lines.push({
        newMsg, brk: newMsg ? 0 : t.breakBefore, kind: t.lineKind || '',
        bullet: t.bullet || '', indent: t.indent || 0, role: t.role, items: [],
      })
    }
    prevMsg = t.messageIndex
    lines[lines.length - 1].items.push([t, i])
  })
  for (const ln of lines) { ln.first = ln.items[0][1]; ln.last = ln.items[ln.items.length - 1][1] }
  return lines
}

// One line of the caption. Memoised: while reading, only the line holding the
// current word (and the one just left) changes, so a 5,000-word message does not
// re-render thousands of spans per word. `state` is past | current | future;
// `cur` is the current index for the current line and -1 for all the others.
const CaptionLine = memo(function CaptionLine({ ln, state, cur, onJumpTo, currentRef, showRoleTags }) {
  const words = ln.items.map(([t, i], k) => {
    const next = ln.items[k + 1]
    const glue = next && next[0].joinPrev // a split long word: no space before its next part
    return h(Fragment, { key: i },
      h('span', {
        ref: i === cur ? currentRef : undefined,
        onClick: () => onJumpTo(i),
        className: 'cursor-pointer rounded px-px hover:bg-bg-elevated ' +
          (isPlaceholder(t) ? 'italic ' : '') + (t.emphasis ? 'font-semibold ' : '') +
          (i === cur ? 'bg-accent-subtle text-text-strong font-semibold'
            : state === 'past' || (state === 'current' && i < cur) ? 'text-muted'
              : (isPlaceholder(t) ? 'text-muted-strong' : '')),
      }, t.text), glue ? null : ' ')
  })
  // The list item holding the current word gets a bar + faint tint. Every item
  // reserves the same bar width, so the text does not shift as it moves.
  const isItem = ln.kind === 'li'
  const active = isItem && state === 'current'
  const itemStyle = isItem ? {
    borderLeft: `3px solid ${active ? 'var(--accent, currentColor)' : 'transparent'}`,
    paddingLeft: 6, borderRadius: 4,
    background: active ? 'color-mix(in srgb, var(--accent, currentColor) 10%, transparent)' : undefined,
  } : undefined
  const body = ln.bullet
    ? h('div', { className: 'flex', style: { paddingLeft: ln.indent * 16 } },
        h('span', { className: 'shrink-0 w-5 text-right pr-1.5 text-muted select-none' }, ln.bullet),
        h('div', { className: 'min-w-0' }, words))
    : words
  return h(Fragment, null,
    showRoleTags && ln.newMsg && h('div', { className: 'text-[10px] text-muted bg-bg-elevated border border-border rounded px-1.5 mt-2 mb-1 w-fit' }, ln.role),
    h('div', { className: (ln.brk >= 2 ? 'mt-2 ' : '') + (LINE_CLASS[ln.kind] || ''), style: itemStyle }, body))
})

export function ContextCaption({ tokens, currentIndex, onJumpTo, showRoleTags, compact, playing }) {
  const currentRef = useRef(null)
  const boxRef = useRef(null)
  // Follow the current word, unless the reader scrolled away on purpose.
  const [following, setFollowing] = useState(true)
  const lines = useMemo(() => groupLines(tokens), [tokens])

  useEffect(() => {
    // Paused and moved by hand (arrows, scrubbing): bring the caption back.
    if (!playing && !following) setFollowing(true)
    // eslint-disable-next-line
  }, [currentIndex])

  useEffect(() => {
    const box = boxRef.current
    const el = currentRef.current
    if (!following || !box || !el) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const pad = 24
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
    // Scroll the caption box itself -- scrollIntoView would also scroll the page.
    if (r.top < b.top + pad) box.scrollTo({ top: box.scrollTop + (r.top - b.top) - pad, behavior })
    else if (r.bottom > b.bottom - pad) box.scrollTo({ top: box.scrollTop + (r.bottom - b.bottom) + pad, behavior })
  }, [currentIndex, following, lines])

  const jump = useCallback((i) => { setFollowing(true); onJumpTo(i) }, [onJumpTo])
  const stopFollowing = () => setFollowing(false)

  return h('div', { className: compact ? 'rounded-xl border border-border bg-card p-3' : 'rounded-xl border border-border bg-card p-4' },
    h('div', { className: 'text-[11px] uppercase tracking-wide text-muted font-semibold mb-2.5' },
      'Context — click any word to jump'),
    h('div', { style: { position: 'relative' } },
      h('div', {
        ref: boxRef,
        // A wheel / touch / drag on the scrollbar means "I am looking elsewhere".
        onWheel: stopFollowing, onTouchMove: stopFollowing, onPointerDown: stopFollowing,
        className: (compact ? 'max-h-[160px]' : 'max-h-[220px]') + ' overflow-y-auto text-sm leading-7 text-muted-strong',
      },
        ...lines.map((ln, k) => {
          const state = ln.last < currentIndex ? 'past' : ln.first > currentIndex ? 'future' : 'current'
          return h(CaptionLine, {
            key: k, ln, state, cur: state === 'current' ? currentIndex : -1,
            onJumpTo: jump, currentRef, showRoleTags,
          })
        }),
      ),
      !following && h('button', {
        className: 'rsvp-focusable text-[11px] bg-accent text-white rounded-md px-2 py-1',
        style: { position: 'absolute', right: 10, bottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,.35)' },
        onClick: () => setFollowing(true),
      }, '↧ Back to current word'),
    ),
  )
}

// The reading block shared by the page and the panel: focal word + controls, then
// the Context box. `compact` is the narrow panel layout.
export function ReaderView({ player, display, compact, showSessionKeys, onHelp }) {
  const { tokens } = player
  // Whether to label turns by role: cheap to keep, costly to recompute per word.
  const showRoleTags = useMemo(() => !!tokens && new Set(tokens.map((t) => t.role)).size > 1, [tokens])
  if (!tokens) return null
  const label = compact ? `${Math.min(player.index + 1, tokens.length)}/${tokens.length}` : player.label
  return h(Fragment, null,
    h('div', null,
      h(RsvpDisplay, { token: player.currentToken, height: player.focalHeight, onResizeStart: player.onResizeStart, display }),
      h(PlaybackControls, {
        playing: player.playing, wpm: player.wpm, pct: player.pct, label, remaining: player.remaining, compact,
        onTogglePlay: player.togglePlay,
        onPrev: () => player.jumpTo(player.index - 1),
        onNext: () => player.jumpTo(player.index + 1),
        onRestart: () => player.jumpTo(0),
        onWpmChange: player.setWpm,
        onScrub: (p) => player.jumpTo(Math.round(p * (tokens.length - 1))),
        onHelp, showSessionKeys,
      }),
    ),
    h(ContextCaption, {
      tokens, currentIndex: player.index, onJumpTo: player.jumpTo, playing: player.playing, compact, showRoleTags,
    }),
  )
}

// Clean/Raw switch + the Settings button.
export function ReaderToolbar({ settings, onSettingsChange, showSettings, onToggleSettings, className }) {
  return h('div', { className },
    !showSettings && h(CleanModeToggle, { settings, onChange: onSettingsChange }),
    h('button', {
      className: 'rsvp-focusable text-[12px] border border-border rounded-md px-2 py-1 bg-card text-muted-strong',
      title: 'Text cleanup and reading display settings',
      onClick: onToggleSettings,
    }, showSettings ? '\u2190 Back to reader' : '\u2699 Settings'),
  )
}

export const ROLE_LABELS = { user: 'You', assistant: 'Agent', tool: 'Tool' }

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '?'
}


// ---------- message picker, notices, help ----------

export function messageLabel(m, wpm) {
  const bits = [`${m.wordCount}w`, readMinutesLabel(m.wordCount, wpm)]
  const when = formatMessageTime(m.ts)
  if (when) bits.push(when)
  return `${roleLabel(m.role)} · ${m.preview} (${bits.join(' · ')})`
}

export function ViewToggle({ view, onChange }) {
  const finalOnly = view === 'final'
  return h('button', {
    className: 'rsvp-focusable shrink-0 text-[12px] border border-border rounded-md px-2 py-1 whitespace-nowrap ' +
      (finalOnly ? 'bg-accent-subtle text-accent border-accent' : 'bg-card text-muted-strong'),
    title: finalOnly
      ? 'Showing your messages and the closing reply of each turn. Click to list every message, narration included.'
      : 'Showing every message, narration included. Click to list only the closing reply of each turn.',
    'aria-pressed': finalOnly,
    onClick: () => onChange(finalOnly ? 'all' : 'final'),
  }, finalOnly ? 'Replies only' : 'All messages')
}

export function MessagePicker({ messages, selectedMessageIndex, onSelect, loading, wpm, view, onViewChange, compact }) {
  if (loading) return h('div', { className: 'text-xs text-muted px-1' }, 'Loading messages…')
  if (!messages || messages.length === 0) return null
  const visible = new Set(visibleMessages(messages, view))
  // The message being read always stays in the list, even when the filter hides it.
  const shown = messages.filter((m) => visible.has(m) || m.index === selectedMessageIndex)
  const select = h('select', {
    className: 'rsvp-focusable text-[13px] bg-bg-elevated text-text border border-border rounded-md px-2.5 py-1.5 flex-1 min-w-0',
    'aria-label': 'Message to read',
    value: selectedMessageIndex === null || selectedMessageIndex === undefined ? '' : String(selectedMessageIndex),
    onChange: (e) => onSelect(Number(e.target.value)),
  }, ...shown.map((m) => h('option', { key: m.index, value: String(m.index) }, messageLabel(m, wpm))))
  const toggle = onViewChange && h(ViewToggle, { view, onChange: onViewChange })
  if (compact) {
    return h('div', { className: 'flex items-center gap-2' }, select, toggle)
  }
  return h('div', { className: 'flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-2.5' },
    select,
    h('span', { className: 'text-xs text-muted whitespace-nowrap' },
      `${shown.length} of ${messages.length} messages · most recent first`),
    toggle,
  )
}

const NOTICE = 'text-[12px] bg-accent-subtle border border-accent text-accent rounded-md px-2.5 py-1.5 flex items-center gap-2 flex-wrap'
const NOTICE_BTN = 'rsvp-focusable text-[12px] border border-accent rounded-md px-2 py-0.5'

// "Picked up where you left off" and "a new reply arrived" bars.
export function Notices({ resume, onStartOver, newReply, onOpenNewReply, onDismissNewReply }) {
  if (resume == null && !newReply) return null
  return h('div', { className: 'flex flex-col gap-1.5', role: 'status' },
    newReply && h('div', { className: NOTICE },
      h('span', { className: 'flex-1 min-w-0' }, 'New reply in this conversation'),
      h('button', { className: NOTICE_BTN, onClick: onOpenNewReply }, 'Read it'),
      h('button', { className: NOTICE_BTN, 'aria-label': 'Dismiss', onClick: onDismissNewReply }, '✕'),
    ),
    resume != null && h('div', { className: NOTICE },
      h('span', { className: 'flex-1 min-w-0' }, `Picked up where you left off (${resume}%)`),
      h('button', { className: NOTICE_BTN, onClick: onStartOver }, 'Start over'),
    ),
  )
}

export function ShortcutsHelp({ onClose, showSessionKeys }) {
  const rows = SHORTCUTS.filter(([keys]) => showSessionKeys || !keys.startsWith('Shift + ↑'))
  return h('div', { className: 'rounded-xl border border-border bg-card p-3.5', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { className: 'flex items-center justify-between mb-2' },
      h('strong', { className: 'text-[13px] text-text-strong' }, 'Keyboard shortcuts'),
      h('button', { className: 'rsvp-focusable text-[12px] border border-border rounded-md px-2 py-0.5 bg-card text-muted-strong', onClick: onClose }, 'Close (Esc)'),
    ),
    h('div', { className: 'grid gap-y-1 gap-x-3 text-[12px]', style: { gridTemplateColumns: 'auto 1fr' } },
      ...rows.flatMap(([keys, what], i) => [
        h('span', { key: 'k' + i }, h('kbd', { className: KBD }, keys)),
        h('span', { key: 'w' + i, className: 'text-muted-strong' }, what),
      ]),
    ),
  )
}

const TIPS_KEY = 'rsvp-reader:tips-seen'

export function useTipsSeen() {
  const [seen, setSeen] = useState(() => {
    try { return window.localStorage.getItem(TIPS_KEY) === '1' } catch { return true }
  })
  const markSeen = useCallback(() => {
    setSeen(true)
    try { window.localStorage.setItem(TIPS_KEY, '1') } catch { /* ignore */ }
  }, [])
  return [seen, markSeen]
}

// First-run hints: the three things people do not find on their own.
export function TipsCard({ onDismiss, onHelp }) {
  const tip = (title, text) => h('li', { className: 'mb-1' }, h('strong', { className: 'text-text-strong' }, title), ' ', text)
  return h('div', { className: 'rounded-xl border border-accent bg-accent-subtle p-3.5 text-[12px] text-text', role: 'note' },
    h('strong', { className: 'text-[13px] text-text-strong' }, 'Quick tour'),
    h('ul', { className: 'mt-1.5', style: { listStyle: 'disc', paddingLeft: 18 } },
      tip('Space', 'plays and pauses; ← → step one word; [ ] change the speed.'),
      tip('Click any word', 'in the Context box to jump there.'),
      tip('⚙ Settings', 'changes how lists, tables, code, links and long words are read. Clean / Raw shows the original text.'),
    ),
    h('div', { className: 'flex gap-2 mt-2' },
      h('button', { className: NOTICE_BTN + ' bg-accent text-white', onClick: onDismiss }, 'Got it'),
      onHelp && h('button', { className: NOTICE_BTN, onClick: () => { onDismiss(); onHelp() } }, 'All shortcuts (?)'),
    ),
  )
}

// ---------- text-cleanup settings (Markdown noise -> readable words) ----------
//
// The BACKEND does the cleanup (backend/md_clean.py); this is only the model of
// the settings + the Settings screen. The same flat object is sent to the
// backend as `clean` (query param on GET routes, body field on POST) and it
// validates every field itself, so a stale/invalid stored value can never break
// reading -- it just falls back to that field's default there.

export const SETTINGS_STORAGE_KEY = 'rsvp-reader:clean-settings'

// value -> label, per option. Also the validation list for stored settings.
export const FORMAT_OPTIONS = {
  emphasis: [['bold', 'Bold on screen'], ['plain', 'Plain text'], ['raw', 'Keep markers']],
  headings: [['clean', 'Clean'], ['raw', 'Raw']],
  lists: [['clean', 'Clean'], ['raw', 'Raw']],
  list_pause: [['comma', 'Comma'], ['sentence', 'Sentence'], ['none', 'None']],
  inline: [['smart', 'Smart'], ['read', 'Always read'], ['code', 'Collapse code-like']],
  blocks: [['diff', 'Summary + diff stats'], ['summary', 'Summary only']],
  tables: [['auto', 'Read small, collapse big'], ['collapse', 'Always collapse'], ['read', 'Always read']],
  links: [['text', 'Text only'], ['textdom', 'Text + domain']],
  urls: [['dom1', 'Domain + 1 segment'], ['dom', 'Domain only'], ['full', 'Full URL'], ['hide', 'Hide']],
  paths: [['parent', 'folder/file'], ['base', 'file only'], ['full', 'Full path'], ['ph', '[file]']],
  hashes: [['short', '7 chars'], ['ph', '[id]'], ['full', 'Full']],
  html: [['clean', 'Remove tags'], ['keep', 'Keep as is']],
  options: [['hide', 'Skip them'], ['read', 'Read them'], ['keep', 'Keep as is']],
  lang: [['en', 'English'], ['pt', 'Português']],
  mode: [['clean', 'Clean'], ['raw', 'Raw']],
  split_long: [['on', 'Split into parts'], ['off', 'Keep whole']],
}

// key -> [min, max, step]; same bounds the backend clamps to.
export const NUMBER_LIMITS = {
  table_rows: [1, 60, 1],
  table_cols: [1, 12, 1],
  pause_emphasis: [0.5, 4, 0.1],
  pause_headings: [0.5, 6, 0.1],
  pause_blocks: [0.5, 6, 0.1],
  pause_tables: [0.5, 6, 0.1],
  pause_urls: [0.5, 6, 0.1],
  pause_item_start: [0.5, 3, 0.1],
  long_word_len: [8, 60, 1],
  pause_hard: [1, 3, 0.05],
}

const BASE_SETTINGS = {
  mode: 'clean', emphasis: 'bold', headings: 'clean', lists: 'clean', list_pause: 'comma',
  inline: 'smart', blocks: 'diff', tables: 'auto', links: 'text', urls: 'dom1', paths: 'parent',
  hashes: 'short', html: 'clean', options: 'hide', lang: 'en',
  table_rows: 6, table_cols: 4,
  pause_emphasis: 1.2, pause_headings: 2.4, pause_blocks: 2.4, pause_tables: 2.4, pause_urls: 1.5,
  pause_item_start: 1.3,
  split_long: 'on', long_word_len: 20, pause_hard: 1.25,
}

export const PRESETS = {
  balanced: { ...BASE_SETTINGS },
  minimal: {
    ...BASE_SETTINGS, emphasis: 'plain', inline: 'code', blocks: 'summary', tables: 'collapse',
    urls: 'hide', paths: 'base', hashes: 'ph',
  },
  detailed: {
    ...BASE_SETTINGS, inline: 'read', tables: 'read', links: 'textdom', urls: 'full', paths: 'full', hashes: 'full',
  },
}

const PRESET_INFO = {
  minimal: ['Minimal', 'Hides URLs, collapses every table and code snippet.'],
  balanced: ['Balanced', 'Reads small tables, folder/file paths, link domains.'],
  detailed: ['Detailed', 'Cleans markers only: full paths and URLs, reads all tables.'],
}

export const DEFAULT_SETTINGS = PRESETS.balanced

// Keep only known keys with valid values; everything else falls back to the default.
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return out
  for (const key of Object.keys(FORMAT_OPTIONS)) {
    if (typeof raw[key] === 'string' && FORMAT_OPTIONS[key].some(([v]) => v === raw[key])) out[key] = raw[key]
  }
  for (const [key, [lo, hi]] of Object.entries(NUMBER_LIMITS)) {
    const v = Number(raw[key])
    if (Number.isFinite(v)) out[key] = Math.max(lo, Math.min(hi, v))
  }
  return out
}

export function loadStoredSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) return sanitizeSettings(JSON.parse(raw))
  } catch {
    // localStorage unavailable or corrupt JSON -- use the defaults.
  }
  return { ...DEFAULT_SETTINGS }
}

// Which preset the current values equal ('custom' when none). `mode` is a
// separate switch (Clean/Raw), so it does not take part in the comparison.
export function detectPreset(settings) {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (Object.keys(preset).every((k) => k === 'mode' || preset[k] === settings[k])) return name
  }
  return 'custom'
}

// Query-string fragment for the GET routes.
export function cleanQuery(settings) {
  return `clean=${encodeURIComponent(JSON.stringify(settings))}`
}

// Shared by the page and the panel: persisted, and kept in sync across both
// (they are separate documents on the same origin, so the `storage` event
// fires in the other one when either changes the settings).
export function useCleanSettings() {
  const [settings, setSettings] = useState(loadStoredSettings)

  useEffect(() => {
    try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== SETTINGS_STORAGE_KEY || !e.newValue) return
      try {
        const next = sanitizeSettings(JSON.parse(e.newValue))
        setSettings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      } catch { /* ignore corrupt value */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [settings, setSettings]
}

// Look & feel of the reader (font, spacing, focal letter, resume behaviour):
// persisted and kept in sync between the page and the panel, like the cleanup settings.
export function useDisplaySettings() {
  const [display, setDisplay] = useState(loadStoredDisplay)

  useEffect(() => {
    try { window.localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)) } catch { /* ignore */ }
  }, [display])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== DISPLAY_KEY || !e.newValue) return
      try {
        const next = sanitizeDisplay(JSON.parse(e.newValue))
        setDisplay((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      } catch { /* ignore corrupt value */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return [display, setDisplay]
}

// 'final' (default) = only the closing reply of each turn; 'all' = every message.
export function useViewMode() {
  const [view, setView] = useState(() => {
    try { return window.localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'final' } catch { return 'final' }
  })
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_KEY, view) } catch { /* ignore */ }
  }, [view])
  return [view, setView]
}

// Quick Clean/Raw switch for the reading view (recover the original text if a
// rule ever ate something you needed).
export function CleanModeToggle({ settings, onChange }) {
  const raw = settings.mode === 'raw'
  return h('button', {
    className: 'text-[12px] border border-border rounded-md px-2 py-1 ' + (raw ? 'bg-accent-subtle text-accent border-accent' : 'bg-card text-muted-strong'),
    title: raw ? 'Showing the original text. Click to clean the Markdown again.' : 'Markdown is being cleaned. Click to show the original text.',
    onClick: () => onChange({ ...settings, mode: raw ? 'clean' : 'raw' }),
  }, raw ? 'Raw' : 'Clean')
}

// A real sample of the shapes that cause noise in agent replies (bold, path,
// hash, URL, a word with a slash, table, diff, OPTIONS line...). Sent to the
// REAL backend, so the preview is exactly what reading will look like.
const PREVIEW_SAMPLE = [
  '## Plano proposto',
  'O **ponto principal**: editei `/home/user/project/app/ui/panel.mjs` no commit 4f9c2ab1e7, veja https://github.com/example/project e o `incidente/manutenção`.',
  'Para cada item:',
  '1. primeiro com a versão v0.7.1',
  '2. segundo com `getUserNameFromSessionStoreFactoryXYZ`',
  '- primeiro item da lista',
  '| Categoria | Vira |',
  '|---|---|',
  '| Ênfase | importante |',
  '| Lista | item |',
  '```diff',
  '--- /dev/null',
  '+++ /home/user/project/app/ui/panel.mjs',
  '+linha nova',
  '```',
  'Chame `dataLayer.push({ event: "x" })` e pronto.',
  '[OPTIONS: Faça A | Faça B]',
].join('\n')

const ROWS = [
  { key: 'emphasis', label: 'Emphasis', num: 'pause_emphasis', numLabel: 'pause' },
  { key: 'headings', label: 'Headings', num: 'pause_headings', numLabel: 'pause after' },
  { key: 'lists', label: 'Lists', sel: 'list_pause', selLabel: 'item end', num: 'pause_item_start', numLabel: 'item start' },
  { key: 'split_long', label: 'Long words', num: 'long_word_len', numLabel: 'max letters', unit: '' },
  { key: 'hard', label: 'Numbers / IDs', noFormat: true, hint: 'versions, ids, snake_case, paths', num: 'pause_hard', numLabel: 'pause' },
  { key: 'inline', label: 'Inline code' },
  { key: 'blocks', label: 'Code blocks', num: 'pause_blocks', numLabel: 'pause' },
  { key: 'tables', label: 'Tables', limit: true, num: 'pause_tables', numLabel: 'pause' },
  { key: 'links', label: 'Markdown links' },
  { key: 'urls', label: 'Bare URLs', num: 'pause_urls', numLabel: 'pause' },
  { key: 'paths', label: 'File paths' },
  { key: 'hashes', label: 'Hashes / IDs' },
  { key: 'html', label: 'HTML' },
  { key: 'options', label: 'Options line' },
  { key: 'lang', label: 'Placeholders' },
]

const SELECT_CLASS = 'text-[13px] bg-bg-elevated text-text border border-border rounded-md px-2 py-1 max-w-full'
const NUM_CLASS = 'text-[13px] bg-bg-elevated text-text border border-border rounded-md px-1.5 py-1'

export function SettingsPanel({ api, apiBase, settings, onChange, onClose, compact, display = DISPLAY_DEFAULTS, onDisplayChange }) {
  const [preview, setPreview] = useState([])
  const [previewError, setPreviewError] = useState(false)
  const [cur, setCur] = useState(0)
  const [hovering, setHovering] = useState(false)
  const settingsKey = JSON.stringify(settings)
  const active = detectPreset(settings)

  const set = (patch) => onChange({ ...settings, ...patch })

  // Preview = the real tokenizer on the sample, debounced while you edit.
  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      api.post(`${apiBase}/text/tokenize`, { text: PREVIEW_SAMPLE, clean: settings })
        .then((d) => { if (!cancelled) { setPreview(d.tokens || []); setPreviewError(false) } })
        .catch((err) => { console.error('[RSVP Reader] settings preview failed:', err); if (!cancelled) setPreviewError(true) })
    }, 200)
    return () => { cancelled = true; clearTimeout(handle) }
    // eslint-disable-next-line
  }, [settingsKey])

  // The focal word walks through the sample (paused while the pointer is over it).
  useEffect(() => {
    if (!preview.length || hovering) return undefined
    const t = setInterval(() => setCur((c) => (c + 1) % preview.length), 900)
    return () => clearInterval(t)
  }, [preview, hovering])

  const shown = preview.length ? preview[Math.min(cur, preview.length - 1)] : undefined

  const formatSelect = (key, width) => h('select', {
    className: SELECT_CLASS + ' rsvp-focusable', value: settings[key], style: width ? { width } : undefined,
    onChange: (e) => set({ [key]: e.target.value }),
  }, ...FORMAT_OPTIONS[key].map(([v, label]) => h('option', { key: v, value: v }, label)))

  // Uncontrolled + commit on blur/Enter/spinner: a controlled number input
  // would erase the "." while typing "1.5" (it re-parses "1." as 1).
  const numberInput = (key) => {
    const [lo, hi, step] = NUMBER_LIMITS[key]
    const commit = (el) => {
      const v = parseFloat(el.value)
      if (Number.isFinite(v)) set({ [key]: Math.max(lo, Math.min(hi, v)) })
      else el.value = String(settings[key])
    }
    return h('input', {
      key: `${key}:${settings[key]}`, type: 'number', min: lo, max: hi, step,
      defaultValue: settings[key], className: NUM_CLASS, style: { width: '4.25rem' },
      onBlur: (e) => commit(e.target),
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } },
      onChange: (e) => { if (!e.nativeEvent.inputType) commit(e.target) }, // spinner arrows
    })
  }

  const label = (text) => h('span', { className: 'text-[11px] text-muted' }, text)

  // One grid per ROW (not one grid for all cells): the borders belong to the row, so
  // category / format / pause always line up, however tall a cell gets. Columns are
  // sized to their content so Pause sits next to Format instead of at the far edge.
  const COLS = '9rem minmax(15rem, 19rem) minmax(0, 1fr)'
  const rowStyle = compact ? undefined : { display: 'grid', alignItems: 'center', gridTemplateColumns: COLS }
  const CELL = 'flex items-center gap-1.5 flex-wrap px-2.5 py-1.5'

  // ---- reading display (look & feel) ----
  const setDisp = (patch) => onDisplayChange && onDisplayChange({ ...display, ...patch })
  const dispNumber = (key) => {
    const [lo, hi, step] = DISPLAY_LIMITS[key]
    const commit = (el) => {
      const v = parseFloat(el.value)
      if (Number.isFinite(v)) setDisp({ [key]: Math.max(lo, Math.min(hi, v)) })
      else el.value = String(display[key])
    }
    return h('input', {
      key: `${key}:${display[key]}`, type: 'number', min: lo, max: hi, step,
      defaultValue: display[key], className: NUM_CLASS + ' rsvp-focusable', style: { width: '4.25rem' },
      'aria-label': key,
      onBlur: (e) => commit(e.target),
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } },
      onChange: (e) => { if (!e.nativeEvent.inputType) commit(e.target) },
    })
  }
  const dispRow = (key, name, control, hint) => h('div', {
    key, className: 'flex items-center gap-2 flex-wrap',
  },
    h('span', { className: 'text-[13px] text-text-strong', style: { minWidth: '10.5rem' } }, name),
    control,
    hint && h('span', { className: 'text-[11px] text-muted' }, hint),
  )

  const header = !compact && h('div', { style: rowStyle },
    h('div', { className: 'px-2.5 py-1.5 text-[11px] font-semibold text-muted' }, 'Category'),
    h('div', { className: 'px-2.5 py-1.5 text-[11px] font-semibold text-muted' }, 'Format'),
    h('div', { className: 'px-2.5 py-1.5 text-[11px] font-semibold text-muted' }, 'Pause'),
  )
  const rows = ROWS.map((r) => {
    const control = h('div', { className: CELL },
      r.noFormat ? h('span', { className: 'text-[11px] text-muted' }, r.hint) : formatSelect(r.key, '13rem'),
      r.limit && settings.tables === 'auto' && h('span', { className: 'flex items-center gap-1' },
        label('up to'), numberInput('table_rows'), label('×'), numberInput('table_cols')),
    )
    const hasPause = !!(r.num || r.sel)
    const pause = hasPause ? h('div', { className: CELL },
      r.num && h('span', { className: 'flex items-center gap-1' }, h('span', { className: 'text-[11px] text-muted', style: { minWidth: '5.25rem' } }, r.numLabel), numberInput(r.num), (r.unit === undefined ? label('×') : r.unit ? label(r.unit) : null)),
      r.sel && h('span', { className: 'flex items-center gap-1 ml-3' }, label(r.selLabel), formatSelect(r.sel)),
    ) : h('div', null)
    return h('div', { key: r.key, className: 'border-t border-border', style: rowStyle },
      h('div', { className: 'px-2.5 py-1.5 text-[13px] font-semibold text-text-strong' }, r.label),
      control,
      compact ? (hasPause ? pause : null) : pause,
    )
  })

  return h('div', { className: 'rounded-xl border border-border bg-card' },
    h('div', { className: 'flex items-center justify-between gap-2 px-3.5 py-3' },
      h('strong', { className: 'text-[15px] text-text-strong' }, 'Text cleanup'),
      h('span', { className: 'flex items-center gap-2' },
        label('Mode'), formatSelect('mode'),
        onClose && h('button', {
          className: 'text-[12px] bg-accent-subtle border border-accent text-accent rounded-md px-2 py-1',
          onClick: onClose,
        }, 'Done'),
      ),
    ),
    h('div', { className: 'px-3.5 pb-3' },
      h(RsvpDisplay, { token: shown, height: 96, hideHandle: true, onResizeStart: () => {}, display }),
      h('div', {
        className: 'mt-2 rounded-lg bg-bg-elevated text-text px-3 py-2 font-mono text-[12px] leading-7 overflow-y-auto',
        style: { maxHeight: compact ? '9rem' : '11rem' },
        onMouseEnter: () => setHovering(true), onMouseLeave: () => setHovering(false),
      },
        previewError && h('span', { className: 'text-danger' }, 'Preview unavailable.'),
        ...preview.map((t, i) => h('span', {
          key: i, onClick: () => setCur(i),
          className: 'cursor-pointer rounded px-px ' + (isPlaceholder(t) ? 'italic text-muted-strong ' : '') + (t.emphasis ? 'font-bold ' : '') +
            (i === Math.min(cur, preview.length - 1) ? 'bg-accent-subtle text-text-strong' : ''),
        }, t.text + ' ')),
      ),
      h('div', { className: 'mt-1 text-[11px] text-muted' }, 'Preview of a real sample, tokenized by the app. Hover to pause, click a word to jump.'),
    ),
    h('div', { className: 'grid gap-2 px-3.5 pb-2', style: { gridTemplateColumns: compact ? '1fr' : 'repeat(3, minmax(0, 1fr))' } },
      ...Object.entries(PRESET_INFO).map(([name, [title, desc]]) => h('button', {
        key: name, onClick: () => onChange({ ...PRESETS[name], mode: settings.mode }),
        className: 'text-left rounded-lg border px-3 py-2 bg-bg-elevated text-text ' + (active === name ? 'border-accent' : 'border-border'),
        style: active === name ? { outline: '2px solid var(--accent, currentColor)', outlineOffset: '-1px' } : undefined,
      },
        h('div', { className: 'text-[13px] font-semibold text-text-strong' }, title, name === 'balanced' ? ' (default)' : ''),
        h('div', { className: 'text-[11px] text-muted mt-0.5' }, desc),
      )),
    ),
    h('div', { className: 'px-3.5 pb-1 text-[11px] text-muted' }, 'Active preset: ', h('strong', { className: 'text-text-strong' }, active === 'custom' ? 'Custom' : PRESET_INFO[active][0])),
    h('details', { open: true, className: 'mx-3.5 my-2.5 rounded-lg border border-border' },
      h('summary', { className: 'cursor-pointer px-3 py-2 text-[13px] font-semibold text-text-strong' }, 'Advanced'),
      h('div', null, header, ...rows),
    ),
    onDisplayChange && h('details', { open: true, className: 'mx-3.5 my-2.5 rounded-lg border border-border' },
      h('summary', { className: 'cursor-pointer px-3 py-2 text-[13px] font-semibold text-text-strong' }, 'Reading display'),
      h('div', { className: 'flex flex-col gap-2 px-3 pb-3' },
        dispRow('font', 'Focal word font', h('select', {
          className: SELECT_CLASS + ' rsvp-focusable', value: display.font, 'aria-label': 'Focal word font',
          onChange: (e) => setDisp({ font: e.target.value }),
        }, h('option', { value: 'mono' }, 'Monospace'), h('option', { value: 'sans' }, 'Sans-serif'))),
        dispRow('spacing', 'Letter spacing', dispNumber('spacing'), 'em (0 = normal)'),
        dispRow('orp', 'Highlighted letter at', dispNumber('orp'), '% of the word (35 is the default)'),
        dispRow('rewind', 'On resume, go back', dispNumber('rewind'), 'words, after pausing with Space'),
        dispRow('ramp', 'Slow start after play', h('input', {
          type: 'checkbox', checked: !!display.ramp, className: 'rsvp-focusable', 'aria-label': 'Slow start after play',
          onChange: (e) => setDisp({ ramp: e.target.checked }),
        }), 'the first 5 words come a bit slower'),
      ),
    ),
    h('div', { className: 'flex items-center justify-between gap-2 px-3.5 pb-3.5' },
      h('button', {
        className: 'rsvp-focusable text-[12px] border border-border rounded-md px-2.5 py-1 bg-card text-text',
        onClick: () => { onChange({ ...DEFAULT_SETTINGS, mode: settings.mode }); if (onDisplayChange) onDisplayChange({ ...DISPLAY_DEFAULTS }) },
      }, 'Reset to defaults'),
      h('span', { className: 'text-[11px] text-muted' }, 'Saved automatically · shared by page and panel'),
    ),
  )
}
