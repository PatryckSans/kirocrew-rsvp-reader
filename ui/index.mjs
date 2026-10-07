// RSVP Reader — full page. Served raw via /apps/rsvp-reader/ui/index.mjs, with NO
// build step (plain JS via React.createElement).
//
// window.__kirocrew_modules is the import map the host injects: react,
// @kirocrew/app-sdk, lucide-react resolve from here, never from node_modules.
//
// This file is only the page SHELL (session picker, layout). Everything that
// plays, loads or remembers lives in player.mjs; what is drawn lives in
// rsvp-core.mjs; the pure logic in pure.mjs. The side-panel tab (panel.mjs) is the
// other shell over the same three modules.

const React = window.__kirocrew_modules.react
const { useAppApi } = window.__kirocrew_modules['@kirocrew/app-sdk']
// Real key confirmed by reading /vendor/kirocrew-ui.mjs: '@kirocrew/ui', not
// '@kirocrew/app-sdk/ui' (that latter one is only the ES IMPORT MAP key).
const { PageHeader } = window.__kirocrew_modules['@kirocrew/ui']

const { useState, useEffect, useCallback, useRef, createElement: h } = React

import {
  ReaderView, ReaderToolbar, MessagePicker, Notices, ShortcutsHelp, TipsCard,
  useCleanSettings, useDisplaySettings, useViewMode, useTipsSeen, SettingsPanel,
} from './rsvp-core.mjs'
import { useRsvpPlayer, useSessionReader, useReaderPanels, makeKeyHandler, useAutoFocus } from './player.mjs'

// Real prefix the app-sdk requires: the path passed to api.get/post is compared to
// the PREFIX DECLARED in permissions.api of the manifest.
const API_BASE = '/apps/rsvp-reader/api'

function SessionPicker({ sessions, selectedId, onSelect, onPasteText, loading }) {
  return h('div', { className: 'flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-2.5' },
    h('select', {
      className: 'rsvp-focusable text-[13px] bg-bg-elevated text-text border border-border rounded-md px-2.5 py-1.5',
      'aria-label': 'Session to read',
      value: selectedId || '', disabled: loading,
      onChange: (e) => onSelect(e.target.value),
    },
      h('option', { value: '', disabled: true }, loading ? 'Loading sessions…' : 'Choose a session'),
      ...sessions.map((s) => h('option', { key: s.id, value: s.id }, s.title)),
    ),
    h('span', { className: 'text-xs text-muted flex-1' },
      `${sessions.length} sessions loaded from `, h('code', { className: 'text-muted' }, '~/.kiro/crew/sessions/')),
    h('button', {
      className: 'rsvp-focusable text-[13px] bg-accent-subtle border border-accent text-accent rounded-md px-2.5 py-1.5',
      onClick: onPasteText,
    }, 'Paste text'),
  )
}

function initialSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session')
}

function RsvpReader() {
  const api = useAppApi()
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedId, setSelectedId] = useState(initialSessionIdFromUrl())
  // Cleanup settings (Markdown -> readable words) and look & feel, both shared
  // with the side panel through localStorage.
  const [settings, setSettings] = useCleanSettings()
  const [display, setDisplay] = useDisplaySettings()
  const [view, setView] = useViewMode()
  const [tipsSeen, markTipsSeen] = useTipsSeen()
  const containerRef = useRef(null)

  const player = useRsvpPlayer({ display })
  const reader = useSessionReader({ api, apiBase: API_BASE, sessionId: selectedId, settings, player, view })
  const ui = useReaderPanels(player)
  useAutoFocus(containerRef, player.tokens)

  useEffect(() => {
    api.get(`${API_BASE}/sessions`)
      .then((data) => { setSessions(data); setLoadingSessions(false) })
      .catch((err) => { console.error('[RSVP Reader] failed to load sessions:', err); setLoadingSessions(false) })
  }, [])

  const { pasteText } = reader
  const handlePasteSubmit = useCallback((text) => {
    setSelectedId(null)
    ui.setShowPasteBox(false)
    pasteText(text)
    // eslint-disable-next-line
  }, [pasteText])

  // Session navigation (Shift+↑/↓). `sessions` is sorted by updated_at desc, the
  // same convention as the picker. With no session chosen yet, the first key
  // enters through the end of the list.
  const stepSession = useCallback((dir) => {
    if (!sessions.length) return
    const pos = sessions.findIndex((s) => s.id === selectedId)
    const next = pos === -1 ? (dir > 0 ? 0 : sessions.length - 1) : pos + dir
    if (next < 0 || next >= sessions.length) return
    setSelectedId(sessions[next].id)
  }, [sessions, selectedId])

  const { showSettings } = ui
  return h('div', {
    ref: containerRef,
    className: 'px-6 pb-8 overflow-y-auto flex-1 min-h-0 flex flex-col gap-5',
    tabIndex: 0,
    onKeyDown: makeKeyHandler({
      player, blocked: showSettings, onEscape: ui.closeSomething,
      onHelp: ui.toggleHelp, onMessage: reader.stepMessage, onSession: stepSession,
    }),
  },
    h(PageHeader, { title: 'RSVP Reader', subtitle: 'Fast reading of agent outputs' }),
    h(ReaderToolbar, {
      settings, onSettingsChange: setSettings, showSettings, onToggleSettings: ui.toggleSettings,
      className: 'flex items-center justify-end gap-2',
    }),
    showSettings && h(SettingsPanel, {
      api, apiBase: API_BASE, settings, onChange: setSettings, onClose: () => ui.setShowSettings(false), compact: false,
      display, onDisplayChange: setDisplay,
    }),
    !showSettings && !tipsSeen && h(TipsCard, { onDismiss: markTipsSeen, onHelp: () => ui.setShowHelp(true) }),
    !showSettings && ui.showHelp && h(ShortcutsHelp, { onClose: () => ui.setShowHelp(false), showSessionKeys: true }),
    !showSettings && h(SessionPicker, {
      sessions, selectedId, loading: loadingSessions,
      onSelect: setSelectedId,
      onPasteText: () => ui.setShowPasteBox(true),
    }),
    !showSettings && selectedId && h(MessagePicker, {
      messages: reader.messages, selectedMessageIndex: reader.selectedMessageIndex, loading: reader.loadingMessages,
      onSelect: reader.setSelectedMessageIndex, wpm: player.wpm, view, onViewChange: setView,
    }),
    !showSettings && ui.showPasteBox && h('textarea', {
      className: 'rsvp-focusable w-full h-28 rounded-md border border-border bg-bg text-sm p-2.5',
      placeholder: 'Paste the text here and press Ctrl+Enter', 'aria-label': 'Text to read',
      onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePasteSubmit(e.target.value) },
    }),
    !showSettings && reader.error && h('div', { className: 'text-sm text-danger', role: 'alert' }, reader.error),
    !showSettings && h(Notices, {
      resume: reader.resume, onStartOver: reader.startOver,
      newReply: reader.newReply, onOpenNewReply: reader.openNewReply, onDismissNewReply: reader.dismissNewReply,
    }),
    !showSettings && h(ReaderView, { player, display, compact: false, showSessionKeys: true, onHelp: ui.toggleHelp }),
    !showSettings && !player.tokens && !ui.showPasteBox && !reader.loadingMessages && !reader.error && h('div', { className: 'text-sm text-muted mt-2' },
      'Choose a session above, or paste some text, to start reading.'),
  )
}

export default RsvpReader
