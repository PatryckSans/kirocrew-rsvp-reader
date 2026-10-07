// RSVP Reader — side-panel tab entry point, served via
// /apps/rsvp-reader/ui/panel.mjs and mounted by the dashboard's chat side panel
// (contributes.panelTabs in app.json). Distinct from index.mjs (the full page)
// because the panel strip is a narrow column next to the chat: single-column
// layout, compact controls, no PageHeader -- AND because, unlike the page, it has
// NO session picker at all.
//
// Session binding, confirmed by reading the dashboard's own bundle (App-*.js):
// the side panel is not global -- `usePanelTabs(slot)` is instantiated PER CHAT
// SLOT, the same mechanism that scopes the built-in Changes/Subagents/Files tabs
// to "this conversation". Every useAppApi() request from a component mounted
// inside that panel carries an `X-Session-Key: dashboard:<slot>` header. The
// backend's `/api/panel-session` route reads it and resolves the real session id,
// so this component never needs a dropdown.
//
// Like index.mjs this is only a shell: playback and loading live in player.mjs,
// the drawing in rsvp-core.mjs, the pure logic in pure.mjs.

const React = window.__kirocrew_modules.react
const { useAppApi } = window.__kirocrew_modules['@kirocrew/app-sdk']

const { useState, useEffect, useCallback, useRef, createElement: h } = React

import {
  FOCAL_HEIGHT_MIN,
  ReaderView, ReaderToolbar, MessagePicker, Notices, ShortcutsHelp, TipsCard,
  useCleanSettings, useDisplaySettings, useViewMode, useTipsSeen, SettingsPanel,
} from './rsvp-core.mjs'
import { useRsvpPlayer, useSessionReader, useReaderPanels, makeKeyHandler, useAutoFocus } from './player.mjs'

const API_BASE = '/apps/rsvp-reader/api'

// Panel-sized focal box: the strip is narrow, so the page's up-to-640px manual
// resize range would routinely not fit. The stored value is still shared with the
// full page -- only the ALLOWED RANGE differs.
const PANEL_FOCAL_HEIGHT_MAX = 260
const clampPanelHeight = (v) => Math.max(FOCAL_HEIGHT_MIN, Math.min(PANEL_FOCAL_HEIGHT_MAX, v))

function RsvpReaderPanel() {
  const api = useAppApi()
  // `selectedId` is resolved automatically from /api/panel-session. `sessionState`
  // tells "still resolving" apart from "resolved to nothing".
  const [selectedId, setSelectedId] = useState(null)
  const [sessionState, setSessionState] = useState('loading') // 'loading' | 'ready' | 'none'
  const [bindError, setBindError] = useState('')
  const [settings, setSettings] = useCleanSettings()
  const [display, setDisplay] = useDisplaySettings()
  const [view, setView] = useViewMode()
  const [tipsSeen, markTipsSeen] = useTipsSeen()
  const containerRef = useRef(null)

  const player = useRsvpPlayer({ display, clampHeight: clampPanelHeight })
  const reader = useSessionReader({ api, apiBase: API_BASE, sessionId: selectedId, settings, player, view })
  const ui = useReaderPanels(player)
  useAutoFocus(containerRef, player.tokens)

  useEffect(() => {
    api.get(`${API_BASE}/panel-session`)
      .then((data) => { setSelectedId(data.sessionId); setSessionState('ready') })
      .catch((err) => {
        // err.body carries the backend's JSON error (it says what header it got) --
        // surface it so a real failure is diagnosable from the panel itself.
        console.error('[RSVP Reader] could not resolve this panel\u2019s session:', err)
        setSessionState('none')
        setBindError(err && err.body ? String(err.body) : (err && err.message) || 'unknown error')
      })
  }, [])

  const { pasteText } = reader
  const handlePasteSubmit = useCallback((text) => {
    ui.setShowPasteBox(false)
    pasteText(text)
    // eslint-disable-next-line
  }, [pasteText])

  const { showSettings, showPasteBox } = ui
  const { tokens } = player
  const noMessages = sessionState === 'ready' && reader.messages.length === 0 && !reader.loadingMessages && !reader.isPaste
  return h('div', {
    ref: containerRef,
    className: 'h-full overflow-y-auto flex flex-col gap-3 p-3',
    tabIndex: 0,
    // No Shift+↑/↓ session stepping here: the panel is bound to ONE session.
    onKeyDown: makeKeyHandler({
      player, blocked: showSettings, onEscape: ui.closeSomething,
      onHelp: ui.toggleHelp, onMessage: reader.stepMessage,
    }),
  },
    h('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
      h('div', { className: 'text-[11px] uppercase tracking-wide text-muted font-semibold shrink-0' }, 'RSVP Reader — this conversation'),
      h(ReaderToolbar, {
        settings, onSettingsChange: setSettings, showSettings, onToggleSettings: ui.toggleSettings,
        className: 'flex items-center justify-end gap-2 shrink-0',
      }),
    ),
    showSettings && h(SettingsPanel, {
      api, apiBase: API_BASE, settings, onChange: setSettings, onClose: () => ui.setShowSettings(false), compact: true,
      display, onDisplayChange: setDisplay,
    }),
    !showSettings && !tipsSeen && h(TipsCard, { onDismiss: markTipsSeen, onHelp: () => ui.setShowHelp(true) }),
    !showSettings && ui.showHelp && h(ShortcutsHelp, { onClose: () => ui.setShowHelp(false), showSessionKeys: false }),
    !showSettings && sessionState === 'ready' && selectedId && h(MessagePicker, {
      messages: reader.messages, selectedMessageIndex: reader.selectedMessageIndex, loading: reader.loadingMessages,
      onSelect: reader.setSelectedMessageIndex, wpm: player.wpm, view, onViewChange: setView, compact: true,
    }),
    !showSettings && sessionState !== 'loading' && h('div', { className: 'flex gap-2 flex-wrap' },
      h('button', {
        className: 'rsvp-focusable self-start text-[12px] bg-accent-subtle border border-accent text-accent rounded-md px-2 py-1',
        onClick: () => ui.setShowPasteBox((v) => !v),
      }, 'Paste text instead'),
      reader.isPaste && selectedId && h('button', {
        className: 'rsvp-focusable self-start text-[12px] border border-border rounded-md px-2 py-1 bg-card text-muted-strong',
        onClick: reader.reload,
      }, '\u2190 Back to this conversation'),
    ),
    !showSettings && showPasteBox && h('textarea', {
      className: 'rsvp-focusable w-full h-24 rounded-md border border-border bg-bg text-sm p-2',
      placeholder: 'Paste text, then Ctrl+Enter', 'aria-label': 'Text to read',
      onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePasteSubmit(e.target.value) },
    }),
    !showSettings && reader.error && h('div', { className: 'text-sm text-danger', role: 'alert' }, reader.error),
    !showSettings && h(Notices, {
      resume: reader.resume, onStartOver: reader.startOver,
      newReply: reader.newReply, onOpenNewReply: reader.openNewReply, onDismissNewReply: reader.dismissNewReply,
    }),
    !showSettings && h(ReaderView, { player, display, compact: true, showSessionKeys: false, onHelp: ui.toggleHelp }),
    !showSettings && sessionState === 'loading' && h('div', { className: 'text-sm text-muted' }, 'Finding this conversation…'),
    !showSettings && sessionState === 'none' && !showPasteBox && !tokens && h('div', { className: 'text-sm text-muted' },
      'Could not bind to this conversation\u2019s session. Paste text above instead, or open the full page.',
      bindError && h('div', { className: 'mt-1 text-[10px] text-muted font-mono break-all' }, bindError),
    ),
    !showSettings && sessionState === 'ready' && !tokens && !showPasteBox && !reader.loadingMessages && !reader.error && h('div', { className: 'text-sm text-muted' },
      noMessages
        ? 'Nothing to read yet. Once the agent replies in this chat, its reply shows up here.'
        : 'Choose a message above to start reading.'),
  )
}

export default RsvpReaderPanel
