// RSVP Reader — composer chip (RF6). Props contract confirmed by reading the
// real session-control.mjs of the demo-app: { session, onClose }, default export
// is required (the host mounts it with React.lazy). Served raw, no build step.
//
// Three ways to read from here:
// - "Quick read here": the newest closing reply of THIS conversation plays right
//   inside the popover (a small focal box + play/pause + speed). No navigation.
// - "Open in side panel": there is NO programmatic way to open a
//   contributes.panelTabs tab from outside the chat component that owns
//   usePanelTabs/openPanelTab (confirmed by reading the dashboard bundle: no
//   window event, no useNavigate() capability, no /chat query param triggers
//   it -- only 'sid', 'slot', 'msg', 'mid', 'new', 'prefill' are read). So this
//   button cannot open the tab BY ITSELF -- it points the user at the panel's
//   own '+' menu instead. Once opened from there, the panel tab auto-binds to
//   this exact conversation (see panel.mjs / server.py's /api/panel-session).
// - "Open full page": navigates to the standalone page with this session
//   pre-selected via ?session=.

const React = window.__kirocrew_modules.react
const { useAppApi, useNavigate } = window.__kirocrew_modules['@kirocrew/app-sdk']

const { useState, useEffect, createElement: h } = React

import {
  RsvpDisplay, loadStoredSettings, loadStoredDisplay, cleanQuery, newestFinalAssistant,
} from './rsvp-core.mjs'
import { useRsvpPlayer } from './player.mjs'

// Actual prefix the app-sdk requires -- see the comment in index.mjs.
const API_BASE = '/apps/rsvp-reader/api'

const MINI_HEIGHT = 120

// The newest closing reply, played in the popover. Uses the same player hook, the
// same cleanup settings and the same look as the panel (read once from storage).
function MiniReader({ api, sessionKey }) {
  const [display] = useState(loadStoredDisplay)
  const [settings] = useState(loadStoredSettings)
  const [state, setState] = useState('loading') // loading | ready | empty | error
  const player = useRsvpPlayer({ display })

  useEffect(() => {
    let cancelled = false
    const enc = encodeURIComponent(sessionKey)
    api.get(`${API_BASE}/sessions/${enc}/messages?roles=assistant,user`)
      .then((data) => {
        const m = newestFinalAssistant(data.messages || [])
        if (!m) { if (!cancelled) setState('empty'); return undefined }
        return api.get(`${API_BASE}/sessions/${enc}/messages/${m.index}/tokens?${cleanQuery(settings)}`)
          .then((t) => {
            if (cancelled) return
            player.loadTokens(t.tokens, 0)
            setState(t.tokens.length ? 'ready' : 'empty')
          })
      })
      .catch((err) => { console.error('[RSVP Reader] quick read failed:', err); if (!cancelled) setState('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line
  }, [sessionKey])

  if (state === 'loading') return h('div', { className: 'mt-2 text-[11px] text-muted' }, 'Loading the latest reply…')
  if (state === 'empty') return h('div', { className: 'mt-2 text-[11px] text-muted' }, 'No reply to read yet in this conversation.')
  if (state === 'error') return h('div', { className: 'mt-2 text-[11px] text-danger' }, 'Could not load the latest reply.')

  const { tokens } = player
  const btn = 'rsvp-focusable inline-flex items-center justify-center rounded-md border border-border bg-bg-elevated text-[13px]'
  return h('div', { className: 'mt-2' },
    h(RsvpDisplay, { token: player.currentToken, height: MINI_HEIGHT, hideHandle: true, onResizeStart: () => {}, display }),
    h('div', { className: 'flex items-center gap-2 mt-2' },
      h('button', {
        className: 'rsvp-focusable inline-flex items-center justify-center rounded-md bg-accent text-white text-[14px]',
        style: { width: 34, height: 30 },
        'aria-label': player.playing ? 'Pause' : 'Play', title: 'Play / pause',
        onClick: player.togglePlay,
      }, player.playing ? '⏸' : '▶'),
      h('button', { className: btn, style: { width: 30, height: 30 }, 'aria-label': 'Back to the start', title: 'Restart', onClick: () => player.jumpTo(0) }, '⟲'),
      h('input', {
        type: 'range', min: 100, max: 1000, step: 10, value: player.wpm, className: 'rsvp-focusable flex-1 min-w-0',
        'aria-label': 'Reading speed in words per minute', onChange: (e) => player.setWpm(Number(e.target.value)),
      }),
      h('span', { className: 'text-[11px] text-muted-strong whitespace-nowrap' }, `${player.wpm} WPM`),
    ),
    h('div', { className: 'flex justify-between text-[11px] text-muted mt-1' },
      h('span', null, `${Math.min(player.index + 1, tokens.length)}/${tokens.length}${player.remaining ? ` · ${player.remaining} left` : ''}`),
      h('span', null, `${player.pct}%`),
    ),
  )
}

export default function RsvpChip({ session, onClose }) {
  const api = useAppApi()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [showPanelHint, setShowPanelHint] = useState(false)
  const [quickRead, setQuickRead] = useState(false)

  useEffect(() => {
    if (!session || !session.sessionKey) return
    const qs = new URLSearchParams({ session_key: session.sessionKey }).toString()
    api.get(`${API_BASE}/session-status?${qs}`)
      .then(setStatus)
      .catch(() => setStatus({ state: 'none', tooltip: 'Could not verify' }))
  }, [session && session.sessionKey])

  const openFullPage = () => {
    navigate(`/apps/rsvp-reader?session=${encodeURIComponent(session.sessionKey)}`)
    if (onClose) onClose()
  }
  const disabled = !!(status && status.state === 'none')

  return h('div', { className: 'p-3', style: { minWidth: quickRead ? 320 : 260 } },
    h('div', { className: 'flex items-center gap-1.5 mb-2' },
      h('span', { className: 'text-[13px]' }, '⚡'),
      h('span', { className: 'text-[12px] font-medium text-text' }, 'RSVP Reader'),
    ),
    h('div', { className: 'mb-2.5 pb-2.5 border-b border-border text-[11px] text-muted' },
      status === null ? 'Checking this conversation…' : status.tooltip,
    ),
    h('button', {
      onClick: () => setShowPanelHint((v) => !v),
      disabled,
      className: 'rsvp-focusable w-full text-[12px] py-1.5 px-3 rounded-md bg-accent text-white disabled:opacity-40',
    }, 'Open in side panel'),
    showPanelHint && h('div', {
      className: 'mt-1.5 mb-1 text-[11px] text-muted bg-bg-elevated border border-border rounded-md p-2 leading-snug',
    },
      'Click the ',
      h('strong', { className: 'text-text-strong' }, '+'),
      ' at the top of the right-side panel and choose ',
      h('strong', { className: 'text-text-strong' }, 'RSVP Reader'),
      ' — it opens already bound to this conversation, no setup needed.',
    ),
    h('button', {
      onClick: () => setQuickRead((v) => !v),
      disabled,
      'aria-expanded': quickRead,
      className: 'rsvp-focusable w-full mt-1.5 text-[12px] py-1.5 px-3 rounded-md border border-border bg-bg-elevated text-text disabled:opacity-40',
    }, quickRead ? 'Hide quick read' : 'Quick read here'),
    quickRead && !disabled && session && session.sessionKey &&
      h(MiniReader, { api, sessionKey: session.sessionKey }),
    h('button', {
      onClick: openFullPage,
      disabled,
      className: 'rsvp-focusable w-full mt-1.5 text-[12px] py-1.5 px-3 rounded-md border border-border bg-bg-elevated text-text disabled:opacity-40',
    }, 'Open full page'),
    h('button', {
      onClick: () => onClose && onClose(),
      className: 'rsvp-focusable w-full mt-1.5 text-[11px] text-muted px-2 py-1 rounded border border-border bg-transparent',
    }, 'Close'),
  )
}
