// Integration harness: the REAL ui modules + REAL React 18 + jsdom, talking to the
// REAL backend (serve.py) over a throw-away sessions directory. See README.md.
import { createRequire } from 'module'
import test from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const w = dom.window
globalThis.window = w
globalThis.document = w.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react')
w.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = w.ResizeObserver
w.matchMedia = () => ({ matches: false })
w.HTMLElement.prototype.scrollTo = function () {}
// jsdom has no layout: give every element a size so the focal box measures something.
Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return 100 } })
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 340 } })

const BASE = 'http://127.0.0.1:8791'
let sessionKeyHeader = null
const calls = []
const api = {
  async get(path) {
    calls.push(['GET', path])
    const r = await fetch(BASE + path.replace('/apps/rsvp-reader', ''), { headers: sessionKeyHeader ? { 'X-Session-Key': sessionKeyHeader } : {} })
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.body = await r.text(); throw e }
    return r.json()
  },
  async post(path, body) {
    calls.push(['POST', path])
    const r = await fetch(BASE + path.replace('/apps/rsvp-reader', ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  },
}
const navigations = []
w.__kirocrew_modules = {
  react: React,
  '@kirocrew/app-sdk': { useAppApi: () => api, useNavigate: () => (u) => navigations.push(u) },
  '@kirocrew/ui': { PageHeader: ({ title }) => React.createElement('h1', null, title) },
}

const UI = new URL('../../ui/', import.meta.url).href
const core = await import(UI + 'rsvp-core.mjs')
const player = await import(UI + 'player.mjs')
const Panel = (await import(UI + 'panel.mjs')).default
const Page = (await import(UI + 'index.mjs')).default
const Chip = (await import(UI + 'session-control.mjs')).default

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle(ms = 150) { await act(async () => { await sleep(ms) }) }
async function waitFor(fn, ms = 4000, what = 'condition') {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = fn() } catch { v = null }
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what)
    await act(async () => { await sleep(40) })
  }
}

let root, container
async function mount(Comp, props = {}) {
  container = w.document.createElement('div')
  w.document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(React.createElement(Comp, props)) })
}
async function unmount() {
  if (!root) return
  const r = root, c = container
  root = null
  await act(async () => { r.unmount() })
  c.remove()
}
const $ = (sel) => container.querySelector(sel)
const $$ = (sel) => [...container.querySelectorAll(sel)]
const text = () => container.textContent
const btn = (label) => $$('button').find((b) => (b.getAttribute('aria-label') || b.textContent || '').includes(label))
async function click(el) { await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) }) }
async function key(el, init) {
  await act(async () => { el.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
}
const root$ = () => container.firstElementChild
const focalWord = () => {
  const spans = $$('span.relative')
  return spans.length ? spans[0].textContent : ''
}
const caption = () => $$('div').find((d) => d.textContent.startsWith('Context'))

test.beforeEach(() => { w.localStorage.clear(); sessionKeyHeader = 'dashboard:chat-7-1000'; calls.length = 0 })
// A failed assertion must not leave a mounted tree behind: its polling intervals
// would keep the process alive and the run would never end.
test.afterEach(async () => { try { await unmount() } catch { /* already gone */ } })

export { test, assert, mount, unmount, $, $$, text, btn, click, key, settle, waitFor, sleep, root$, focalWord, caption, core, player, Panel, Page, Chip, api, calls, navigations, w, React, act }
export const setHeader = (v) => { sessionKeyHeader = v }
