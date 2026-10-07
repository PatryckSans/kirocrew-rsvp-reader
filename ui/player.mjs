// RSVP Reader — the stateful part shared by the full page, the side panel and the
// composer chip: playback (timer, ramp-up, resume rewind, resize) and the reader
// of one conversation (message list, tokens, remembered position, new replies).
//
// The page and the panel used to carry two ~200-line copies of this; they are now
// thin shells over these hooks. Framework-free logic is in pure.mjs.

const React = window.__kirocrew_modules.react
const { useState, useEffect, useCallback, useRef, useMemo } = React

import {
  WPM_STORAGE_KEY, loadStoredWpm, clampWpm, WPM_KEY_STEP, stepDurationMs, rampFactor, clampIndex,
  nextSentenceIndex, nextLineIndex, rewindIndex, cumulativeMults, remainingMs, formatDuration,
  FOCAL_HEIGHT_MIN, FOCAL_HEIGHT_MAX, FOCAL_HEIGHT_STORAGE_KEY, loadStoredFocalHeight,
  positionKey, getPosition, savePosition, clearPosition, isRestorable,
  visibleMessages, pickDefaultMessage, stepInList, newestFinalAssistant, keyAction,
} from './pure.mjs'

// ---------- playback ----------

export function useRsvpPlayer({ display, clampHeight = (x) => x }) {
  const [tokens, setTokens] = useState(null)
  const [index, setIndexState] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [wpm, setWpmState] = useState(loadStoredWpm)
  const [focalHeight, setFocalHeight] = useState(() => clampHeight(loadStoredFocalHeight()))

  const tokensRef = useRef(null)
  const indexRef = useRef(0)
  const playingRef = useRef(false)
  const timerRef = useRef(null)
  const rampRef = useRef(0)            // words played since Play was pressed
  const resumeOkRef = useRef(false)    // last stop was a plain pause -> rewind on resume
  const positionRef = useRef(0)        // reading position as a 0..1 fraction
  const resizeStateRef = useRef(null)

  tokensRef.current = tokens
  playingRef.current = playing

  const setIndex = useCallback((i) => { indexRef.current = i; setIndexState(i) }, [])

  useEffect(() => {
    positionRef.current = tokens && tokens.length > 1 ? index / (tokens.length - 1) : 0
  }, [index, tokens])

  // --- speed (persisted, debounced: the slider fires on every step of a drag) ---
  const setWpm = useCallback((v) => setWpmState(clampWpm(v)), [])
  const stepWpm = useCallback((delta) => setWpmState((prev) => clampWpm(prev + delta)), [])
  useEffect(() => {
    const handle = setTimeout(() => {
      try { window.localStorage.setItem(WPM_STORAGE_KEY, String(wpm)) } catch { /* ignore */ }
    }, 400)
    return () => clearTimeout(handle)
  }, [wpm])

  // --- the timer ---
  useEffect(() => {
    if (!playing || !tokens) return undefined
    const dur = (tok) => stepDurationMs(wpm, tok) * (display.ramp ? rampFactor(rampRef.current) : 1)
    const tick = () => {
      const list = tokensRef.current
      const i = indexRef.current
      if (!list || i >= list.length - 1) {
        resumeOkRef.current = false
        setPlaying(false)
        return
      }
      const next = i + 1
      indexRef.current = next
      rampRef.current += 1
      setIndexState(next)
      timerRef.current = setTimeout(tick, dur(list[next]))
    }
    timerRef.current = setTimeout(tick, dur(tokens[indexRef.current]))
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }
    // eslint-disable-next-line
  }, [playing, wpm, tokens, display.ramp])

  // --- controls ---
  // A plain pause: when playback resumes it steps back a few words.
  const pause = useCallback(() => {
    if (!playingRef.current) return
    resumeOkRef.current = true
    setPlaying(false)
  }, [])

  const togglePlay = useCallback(() => {
    if (playingRef.current) { pause(); return }
    const list = tokensRef.current
    if (!list || !list.length) return
    let i = indexRef.current
    if (i >= list.length - 1) {
      i = 0
      resumeOkRef.current = false
    } else if (resumeOkRef.current && display.rewind > 0) {
      i = rewindIndex(i, display.rewind) // pick the thread up a few words back
    }
    setIndex(i)
    rampRef.current = 0
    setPlaying(true)
  }, [display.rewind, setIndex, pause])

  // A deliberate move (arrows, click, scrub): stops playback and cancels the
  // "rewind on resume" -- the reader chose where to be.
  const jumpTo = useCallback((i) => {
    resumeOkRef.current = false
    setPlaying(false)
    const list = tokensRef.current
    setIndex(list ? clampIndex(list, i) : 0)
  }, [setIndex])

  // New tokens: from the start (or `startAt`), paused.
  const loadTokens = useCallback((list, startAt = 0) => {
    resumeOkRef.current = false
    setPlaying(false)
    tokensRef.current = list
    setTokens(list)
    setIndex(list.length ? clampIndex(list, startAt) : 0)
  }, [setIndex])

  // Same text re-cleaned with other settings: stay at the same fraction.
  const replaceTokens = useCallback((list) => {
    const frac = positionRef.current
    tokensRef.current = list
    setTokens(list)
    setIndex(list.length > 1 ? Math.round(frac * (list.length - 1)) : 0)
  }, [setIndex])

  const clearTokens = useCallback(() => {
    setPlaying(false)
    tokensRef.current = null
    setTokens(null)
    setIndex(0)
  }, [setIndex])

  // --- focal box resize (drag the handle) ---
  const onMove = useCallback((e) => {
    const st = resizeStateRef.current
    if (!st) return
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    setFocalHeight(clampHeight(Math.max(FOCAL_HEIGHT_MIN, Math.min(FOCAL_HEIGHT_MAX, st.startHeight + clientY - st.startY))))
    // eslint-disable-next-line
  }, [])
  const onEnd = useCallback(() => {
    if (!resizeStateRef.current) return
    resizeStateRef.current = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    // Persist only on release, not on every dragged pixel.
    setFocalHeight((current) => {
      try { window.localStorage.setItem(FOCAL_HEIGHT_STORAGE_KEY, String(current)) } catch { /* ignore */ }
      return current
    })
  }, [onMove])
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    resizeStateRef.current = { startY: clientY, startHeight: focalHeight }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
  }, [focalHeight, onMove, onEnd])
  useEffect(() => () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onEnd)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
  }, [onMove, onEnd])

  // --- derived ---
  const cum = useMemo(() => (tokens ? cumulativeMults(tokens) : null), [tokens])
  const remaining = tokens && cum && tokens.length > 1 ? formatDuration(remainingMs(cum, index, wpm)) : ''
  const pct = tokens && tokens.length > 1 ? Math.round((index / (tokens.length - 1)) * 100) : 0
  const label = tokens ? `word ${Math.min(index + 1, tokens.length)} / ${tokens.length}` : ''

  return {
    tokens, index, playing, wpm, focalHeight, remaining, pct, label,
    currentToken: tokens ? tokens[index] : undefined,
    setWpm, stepWpm, togglePlay, pause, jumpTo, loadTokens, replaceTokens, clearTokens, onResizeStart,
    positionRef, indexRef,
  }
}

// Which of the optional screens is open (Settings, shortcut list, paste box) and
// what Esc closes. Shared by the page and the panel.
export function useReaderPanels(player) {
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showPasteBox, setShowPasteBox] = useState(false)
  const { pause } = player
  const toggleSettings = useCallback(() => { pause(); setShowSettings((v) => !v) }, [pause])
  const toggleHelp = useCallback(() => setShowHelp((v) => !v), [])
  // Esc: closes the topmost thing; true when it closed something.
  const closeSomething = () => {
    if (showHelp) { setShowHelp(false); return true }
    if (showSettings) { setShowSettings(false); return true }
    if (showPasteBox) { setShowPasteBox(false); return true }
    return false
  }
  return {
    showSettings, setShowSettings, showHelp, setShowHelp, showPasteBox, setShowPasteBox,
    toggleSettings, toggleHelp, closeSomething,
  }
}

// Builds the container's keydown handler from the shared key map, so the page
// and the panel behave identically.
//   blocked   -> true while the Settings screen owns the keys
//   onEscape  -> closes whatever is open; returns true when it closed something
export function makeKeyHandler({ player, blocked, onEscape, onHelp, onMessage, onSession }) {
  return (e) => {
    const tag = e.target && e.target.tagName
    // Typing in a text box keeps its keys. A <select> has no text to edit, and
    // the natural flow is to choose a message in it and keep using ↑/↓.
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    const action = keyAction(e)
    if (!action) return
    if (action === 'escape') { if (onEscape && onEscape()) e.preventDefault(); return }
    if (action === 'help') { e.preventDefault(); if (onHelp) onHelp(); return }
    if (blocked) return
    const { tokens, index } = player
    const go = (fn) => { e.preventDefault(); fn() }
    switch (action) {
      case 'toggle': return go(player.togglePlay)
      case 'wordNext': return go(() => player.jumpTo(tokens ? index + 1 : 0))
      case 'wordPrev': return go(() => player.jumpTo(tokens ? index - 1 : 0))
      case 'sentenceNext': return go(() => player.jumpTo(tokens ? nextSentenceIndex(tokens, index, 1) : 0))
      case 'sentencePrev': return go(() => player.jumpTo(tokens ? nextSentenceIndex(tokens, index, -1) : 0))
      case 'lineNext': return go(() => player.jumpTo(tokens ? nextLineIndex(tokens, index, 1) : 0))
      case 'linePrev': return go(() => player.jumpTo(tokens ? nextLineIndex(tokens, index, -1) : 0))
      case 'messagePrev': return go(() => onMessage && onMessage(-1))
      case 'messageNext': return go(() => onMessage && onMessage(1))
      case 'sessionPrev': return onSession ? go(() => onSession(-1)) : undefined
      case 'sessionNext': return onSession ? go(() => onSession(1)) : undefined
      case 'restart': return tokens ? go(() => player.jumpTo(0)) : undefined
      case 'slower': return go(() => player.stepWpm(-WPM_KEY_STEP))
      case 'faster': return go(() => player.stepWpm(WPM_KEY_STEP))
      default: return undefined
    }
  }
}

// ---------- one conversation ----------

const POLL_MS = 3000
const QUIET_MS = 6000 // announce a new reply only after the file stopped growing this long

export function useSessionReader({ api, apiBase, sessionId, settings, player, view }) {
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [selectedMessageIndex, setSelectedMessageIndex] = useState(null)
  const [error, setError] = useState(null)
  const [resume, setResume] = useState(null)       // percent we resumed at, or null
  const [newReply, setNewReply] = useState(null)   // message object, or null
  const [isPaste, setIsPaste] = useState(false)

  const settingsKey = JSON.stringify(settings)
  const pasteRef = useRef(null)
  const loadedRef = useRef({ sid: null, mid: null, sk: settingsKey })
  const tokensKeyRef = useRef(null)  // position key of the message the tokens belong to
  const canonicalRef = useRef(null)  // the session's real id (the URL may carry a sessionKey)
  const [reloadTick, setReloadTick] = useState(0)
  const knownNewestRef = useRef(-1)  // highest closing-reply index the reader has seen
  const selectedRef = useRef(null)
  selectedRef.current = selectedMessageIndex

  const visible = useMemo(() => visibleMessages(messages, view), [messages, view])

  // Saves the position under the key of the message the TOKENS belong to (not the
  // one just selected, whose tokens are still loading).
  const saveNow = useCallback(() => {
    const k = tokensKeyRef.current
    const list = player.tokens
    if (!k || !list || list.length < 2) return
    savePosition(k, player.indexRef.current / (list.length - 1))
  }, [player.tokens, player.indexRef])
  const saveRef = useRef(saveNow)
  saveRef.current = saveNow

  // --- the session's message list ---
  useEffect(() => {
    saveRef.current()
    tokensKeyRef.current = null
    if (!sessionId) { setMessages([]); setSelectedMessageIndex(null); return }
    setError(null)
    player.clearTokens()
    setResume(null)
    setNewReply(null)
    setIsPaste(false)
    pasteRef.current = null
    setLoadingMessages(true)
    let cancelled = false // a slow answer for a session we already left must not land
    api.get(`${apiBase}/sessions/${sessionId}/messages?roles=assistant,user`)
      .then((data) => {
        if (cancelled) return
        const list = data.messages || []
        canonicalRef.current = data.sessionId || sessionId
        const first = pickDefaultMessage(visibleMessages(list, view))
        const newest = newestFinalAssistant(list)
        knownNewestRef.current = newest ? newest.index : -1
        setMessages(list)
        setSelectedMessageIndex(first ? first.index : null)
        setLoadingMessages(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[RSVP Reader] failed to list session messages:', err)
        setLoadingMessages(false)
        setError('Could not list the messages for this session.')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line
  }, [sessionId, reloadTick])

  // Switching the filter must never leave the selection on a message that is not offered.
  useEffect(() => {
    if (!messages.length || isPaste) return
    const sel = selectedRef.current
    if (sel != null && messages.some((m) => m.index === sel)) return
    const first = pickDefaultMessage(visible)
    setSelectedMessageIndex(first ? first.index : null)
    // eslint-disable-next-line
  }, [view, messages])

  // --- tokens of the chosen message ---
  useEffect(() => {
    if (!sessionId || selectedMessageIndex == null) return undefined
    saveRef.current() // keep where the previous message was left
    // Same message, only the cleanup settings changed: reload but keep the position.
    const prev = loadedRef.current
    const settingsOnly = prev.sid === sessionId && prev.mid === selectedMessageIndex && prev.sk !== settingsKey
    loadedRef.current = { sid: sessionId, mid: selectedMessageIndex, sk: settingsKey }
    pasteRef.current = null
    setIsPaste(false)
    setError(null)
    let cancelled = false
    api.get(`${apiBase}/sessions/${sessionId}/messages/${selectedMessageIndex}/tokens?clean=${encodeURIComponent(settingsKey)}`)
      .then((data) => {
        if (cancelled) return
        const k = positionKey(canonicalRef.current || sessionId, selectedMessageIndex)
        if (settingsOnly) {
          player.replaceTokens(data.tokens)
          tokensKeyRef.current = k
          return
        }
        const saved = getPosition(k)
        tokensKeyRef.current = k
        if (isRestorable(saved) && data.tokens.length > 1) {
          player.loadTokens(data.tokens, Math.round(saved * (data.tokens.length - 1)))
          setResume(Math.round(saved * 100))
        } else {
          player.loadTokens(data.tokens, 0)
          setResume(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[RSVP Reader] failed to load message tokens:', err)
        setError('Could not load this message.')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line
  }, [sessionId, selectedMessageIndex, settingsKey])

  // --- pasted text (re-cleaned when the settings change) ---
  useEffect(() => {
    const text = pasteRef.current
    if (!text) return undefined
    let cancelled = false
    api.post(`${apiBase}/text/tokenize`, { text, clean: settings })
      .then((data) => { if (!cancelled) player.replaceTokens(data.tokens) })
      .catch((err) => { if (!cancelled) console.error('[RSVP Reader] failed to re-clean pasted text:', err) })
    return () => { cancelled = true }
    // eslint-disable-next-line
  }, [settingsKey])

  const pasteText = useCallback((text) => {
    saveRef.current()
    tokensKeyRef.current = null // pasted text has no identity to remember a position under
    setMessages([])
    setSelectedMessageIndex(null)
    setError(null)
    setResume(null)
    setNewReply(null)
    setIsPaste(true)
    pasteRef.current = text
    return api.post(`${apiBase}/text/tokenize`, { text, clean: settings })
      .then((data) => player.loadTokens(data.tokens, 0))
      .catch((err) => { console.error('[RSVP Reader] failed to tokenize pasted text:', err); setError('Could not tokenize this text.') })
    // eslint-disable-next-line
  }, [settingsKey])

  // --- remember the position of the message being read ---
  useEffect(() => {
    // Every 2s while reading (a debounce would never fire during continuous play),
    // and once more when the component goes away.
    const id = setInterval(() => saveRef.current(), 2000)
    return () => { clearInterval(id); saveRef.current() }
  }, [])
  useEffect(() => { if (!player.playing) saveRef.current() }, [player.playing])

  const startOver = useCallback(() => {
    if (tokensKeyRef.current) clearPosition(tokensKeyRef.current)
    setResume(null)
    player.jumpTo(0)
  }, [player.jumpTo])

  // --- a new reply arrives while the panel is open ---
  useEffect(() => {
    if (!sessionId) return undefined
    let stopped = false
    let last = null
    let dirty = false
    let changedAt = 0
    let busy = false // a slow backend must not pile up requests
    const check = async () => {
      if (busy || stopped || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      busy = true
      try {
        const st = await api.get(`${apiBase}/sessions/${sessionId}/stamp`)
        const sig = `${st.mtimeNs}:${st.size}`
        if (last === null) { last = sig; return }            // first reading = baseline
        if (sig !== last) { last = sig; dirty = true; changedAt = Date.now(); return }
        if (!dirty || Date.now() - changedAt < QUIET_MS) return
        dirty = false
        const data = await api.get(`${apiBase}/sessions/${sessionId}/messages?roles=assistant,user`)
        if (stopped || pasteRef.current) return // pasted text on screen: leave it alone
        const list = data.messages || []
        setMessages(list)
        const newest = newestFinalAssistant(list)
        if (newest && newest.index > knownNewestRef.current && newest.index !== selectedRef.current) setNewReply(newest)
      } catch { /* a missed poll is harmless; the next one retries */ } finally { busy = false }
    }
    const id = setInterval(check, POLL_MS)
    check()
    return () => { stopped = true; clearInterval(id) }
    // eslint-disable-next-line
  }, [sessionId])

  const openNewReply = useCallback(() => {
    if (!newReply) return
    knownNewestRef.current = newReply.index
    setSelectedMessageIndex(newReply.index)
    setNewReply(null)
  }, [newReply])

  const dismissNewReply = useCallback(() => {
    if (newReply) knownNewestRef.current = newReply.index
    setNewReply(null)
  }, [newReply])

  const stepMessage = useCallback((dir) => {
    if (!visible.length) return
    const sel = selectedRef.current
    const next = sel == null ? (pickDefaultMessage(visible) || {}).index : stepInList(visible, sel, dir)
    if (next != null) setSelectedMessageIndex(next)
  }, [visible])

  // Leave pasted text and go back to the conversation's own messages.
  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  return {
    reload, messages, visible, loadingMessages, selectedMessageIndex, setSelectedMessageIndex, error, setError,
    resume, startOver, newReply, openNewReply, dismissNewReply, isPaste, pasteText, stepMessage,
  }
}

// Keeps keyboard focus on the reader's container so Space/arrows work without a
// click first (the browser does not route global keys to a <div tabIndex> that
// has no focus). Runs on mount and whenever new tokens arrive.
export function useAutoFocus(containerRef, tokens) {
  useEffect(() => {
    if (tokens && containerRef.current) containerRef.current.focus()
  }, [tokens])
  useEffect(() => {
    if (containerRef.current) containerRef.current.focus()
  }, [])
}
