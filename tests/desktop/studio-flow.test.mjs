// End-to-end UI tests for the Prompt Studio: the real desktop/plugin.js rendered with React in
// jsdom, driven only by button clicks, against a scripted /suggest + /compose backend.
//
// Needs react, react-dom, jsdom, nanostores, @nanostores/react and esbuild. They are resolved from
// PROMPT_STUDIO_NODE_MODULES, the repo's node_modules or the Hermes install. If none has them the
// tests are skipped with the reason printed on stderr, except under CI=1 / CI=true, where the file
// fails at once naming the missing packages. PROMPT_STUDIO_NODE_MODULES_ONLY=1 restricts the search
// to PROMPT_STUDIO_NODE_MODULES (used to prove the missing-dependency path without deleting files).
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const REQUIRED = ['react', 'react-dom', 'jsdom', 'nanostores', '@nanostores/react', 'esbuild']
const candidates = (process.env.PROMPT_STUDIO_NODE_MODULES_ONLY === '1'
  ? [process.env.PROMPT_STUDIO_NODE_MODULES]
  : [process.env.PROMPT_STUDIO_NODE_MODULES, join(repo, 'node_modules'), '/usr/local/lib/hermes-agent/node_modules']
).filter(Boolean)
const nodeModules = candidates.find(dir => REQUIRED.every(pkg => existsSync(join(dir, pkg))))
let skip = false
if (!nodeModules) {
  const missing = REQUIRED.filter(pkg => !candidates.some(dir => existsSync(join(dir, pkg))))
  const reason = `UI tests need ${REQUIRED.join(', ')} in one node_modules directory; none found in [${candidates.join(', ')}]` +
    `${missing.length ? ` (missing everywhere: ${missing.join(', ')})` : ''}. Set PROMPT_STUDIO_NODE_MODULES to a node_modules that has them.`
  if (/^(1|true)$/i.test(process.env.CI || '')) throw new Error(`CI: ${reason}`)
  skip = reason
  console.error(`studio-flow: SKIPPING UI tests: ${reason}`)
}

// PROMPT_STUDIO_LEGACY_SDK=1 runs the file against an SDK stub without ListRow/ToggleRow (Hermes
// 0.20.0..0.21.4); tests/desktop/sdk-compat.test.mjs runs the settings tests that way.
const LEGACY_SDK = process.env.PROMPT_STUDIO_LEGACY_SDK === '1'
const REMOVED = ['category', 'effort', 'tools', 'browsing', 'delegation', 'structure', 'language', 'depth']
const INTENT = 'Crie um app web simples para registrar gastos da casa por categoria, com React e Supabase.'
// A clear code draft: "O que você quer receber" is detected with no real alternative, so it is skipped.
const VAGUE = 'me ajuda com o projeto da empresa, preciso de algo bom'

let ui // the loaded bundle + DOM helpers
const openPorts = []
let tmp

// Scripted backend. Each test replaces the handlers it cares about.
const backend = {
  calls: [],
  suggest: body => ({ ok: true, value: body.field.kind === 'enum' ? body.field.recommended : `sugestão para ${body.field.id}`, reason: 'teste' }),
  compose: body => ({ ok: true, prompt: `PROMPT DA IA (${body.answers.length} respostas)`, notes: 'ok' }),
  context: () => ({ ok: true, summary: 'RESUMO DA SESSAO', model: 'anthropic/claude-haiku-5', turns: 8, ms: 1432 })
}

before(async () => {
  if (skip) return
  const require = createRequire(join(nodeModules, 'noop.js'))
  const esbuild = require('esbuild')
  const { JSDOM } = require('jsdom')

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  const g = globalThis
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) {
    Object.defineProperty(g, key, { configurable: true, writable: true, value: dom.window[key] })
  }
  g.IS_REACT_ACT_ENVIRONMENT = true
  // Auto-mode suggestion debounce (SP-2): 0 ms keeps the other tests fast; the SP-2 test sets the real delay.
  g.__promptStudioAutoSuggestDelayMs = 0
  // Frames run as 0 ms timers (jsdom paces them at 16 ms) and the studio waits 0 ms after the app's composer
  // focus retries (real: 50 ms), so opening settles within settle(); the focus-retry test proves the order.
  g.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0)
  g.cancelAnimationFrame = id => clearTimeout(id)
  g.__promptStudioFocusSettleMs = 0
  // React's scheduler and act() queue work on MessageChannel ports, which keep node:test from
  // exiting. Track every port so after() can close them.
  const RealChannel = globalThis.MessageChannel
  Object.defineProperty(g, 'MessageChannel', {
    configurable: true,
    writable: true,
    value: class TrackedChannel extends RealChannel {
      constructor() { super(); openPorts.push(this.port1, this.port2) }
    }
  })

  tmp = mkdtempSync(join(tmpdir(), 'studio-flow-'))
  // Legacy mode drops the ListRow/ToggleRow exports entirely, as Hermes 0.20.0..0.21.4 do: a named
  // import of them then fails to link, exactly like the Desktop blob shim.
  const sdkSource = `
import { atom as nanoAtom } from 'nanostores'
import { useStore } from '@nanostores/react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createContext, useContext } from 'react'
export const atom = nanoAtom
export const sdkHasRows = ${JSON.stringify(!LEGACY_SDK)}
// Settings dialog stubs (CX-1): just enough of the SDK components to drive them from tests.
export const Codicon = ({ name }) => jsx('span', { 'data-codicon': name })
export const Dialog = ({ open, children }) => (open ? jsx('div', { 'data-sdk-dialog': true, children }) : null)
export const DialogContent = ({ children, className, ...props }) => jsx('div', { ...props, children })
export const DialogHeader = ({ children }) => jsx('div', { children })
export const DialogFooter = ({ children }) => jsx('div', { children })
export const DialogTitle = ({ children }) => jsx('h2', { children })
export const ListRow = ({ title, description, action }) => jsxs('div', { 'data-sdk-list-row': true, children: [jsx('span', { children: title }), description ? jsx('span', { children: description }) : null, action] })
export const ToggleRow = ({ checked, label, onChange }) => jsx('button', { role: 'switch', 'aria-checked': String(checked), 'data-sdk-toggle': true, onClick: () => onChange(!checked), children: label })
const SelectCtx = createContext(null)
export const Select = ({ value, onValueChange, children }) => jsx(SelectCtx.Provider, { value: { onValueChange }, children: jsx('div', { 'data-sdk-select': value, children }) })
export const SelectTrigger = ({ children }) => jsx('div', { children })
export const SelectValue = () => null
export const SelectContent = ({ children }) => jsx('div', { children })
export const SelectItem = ({ value, children }) => { const c = useContext(SelectCtx); return jsx('button', { 'data-sdk-select-item': value, onClick: () => c.onValueChange(value), children }) }
export const DropdownMenu = ({ children }) => jsx('div', { children })
export const DropdownMenuTrigger = ({ children }) => children
export const DropdownMenuContent = ({ children }) => jsx('div', { children })
export const ModelMenuCloseContext = createContext(() => {})
// The catalog menu exposes its controller so a test can play select / setOptions.
export const ModelCatalogMenu = ({ controller }) => { if (globalThis.__promptStudioBreakCatalog) throw new Error('catalog failed'); return jsx('div', { 'data-model-menu': true, ref: el => { if (el) el.__controller = controller } }) }
export const reasoningEffortLabel = effort => 'effort ' + effort
export const useValue = useStore
export const COMPOSER_AREAS = { top: 'top', middleware: 'middleware', actions: 'actions' }
export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const Tip = ({ children }) => children
export const GlyphSpinner = () => null
// Kbd: forwards data-*/aria-* props like the real UI-kit component; records the variant.
export const Kbd = ({ children, variant, size, ...props }) => jsx('kbd', { ...props, 'data-kbd-variant': variant || 'default', children })
// Plugin i18n like apps/desktop/src/i18n/plugin-i18n.ts: active locale -> en -> key.
export const i18n = { locale: 'en', bundles: {} }
function resolve(locale, key, args) {
  let value = i18n.bundles[locale]
  for (const part of key.split('.')) value = value?.[part]
  return typeof value === 'function' ? value(...args) : typeof value === 'string' ? value : null
}
export function translate(key, ...args) {
  return resolve(i18n.locale, key, args) ?? resolve('en', key, args) ?? key
}
export const $locale = nanoAtom('en')
export const usePluginI18n = () => { useStore($locale); return translate }
export const notifications = []
export const host = {
  state: { cwd: nanoAtom('/root'), profile: nanoAtom('default'), model: nanoAtom('claude-opus-5-5'), focusedStoredSessionId: nanoAtom(null), focusedSessionId: nanoAtom('sess-live'), focusedSessionProfile: nanoAtom('default') },
  // host.composer (desktop-plugin-sdk.md): submit is synchronous and fail-closed (false = not sent).
  composer: {
    submits: [],
    focuses: [],
    writes: [],
    submitResult: true,
    // getDraft/setDraft answer from the test composer element, like the app's mounted surface.
    // Staged attachments live beside the text and are never touched by setDraft.
    // __promptStudioComposerGate: a promise the calls wait for (tests of calls still pending).
    // __promptStudioNoActiveComposer: getDraft answers null, as the SDK does when no composer is active.
    // One composer per conversation, like the app: the test element is the composer of the conversation on
    // screen (stored id, else runtime id, else 'new'); other conversations keep their text in offscreen, and are
    // mounted unless __promptStudioSessionUnmounted. null = the composer in use.
    offscreen: new Map(),
    shown() { return host.state.focusedStoredSessionId.get() ?? host.state.focusedSessionId.get() ?? 'new' },
    target(address) {
      const editor = document.querySelector('[data-slot="composer-rich-input"]')
      // null = the composer typed in last: the one on screen unless a test sets another pane's.
      const active = globalThis.__promptStudioActiveComposer
      if (address === null && active && active !== this.shown()) return { key: active }
      if (address === null || address === this.shown() || address === host.state.focusedSessionId.get()) return { editor }
      if (globalThis.__promptStudioSessionUnmounted) return null
      return { key: address }
    },
    read(target) { return target.editor ? target.editor.textContent : (this.offscreen.get(target.key) ?? '') },
    write(target, text) {
      if (!target.editor) { this.offscreen.set(target.key, text); return }
      const editor = target.editor
      editor.textContent = text
      // Like the app (use-composer-draft paintDraft -> focus request -> effect -> focusComposerInput):
      // after the reply, the composer takes the focus now, on the next frame and on a 0 ms timer.
      setTimeout(() => {
        const focus = () => { if (document.activeElement !== editor) editor.focus() }
        focus()
        requestAnimationFrame(focus)
        setTimeout(focus, 0)
      }, 0)
    },
    async getDraft(sessionId) {
      await globalThis.__promptStudioComposerGate
      if (globalThis.__promptStudioNoActiveComposer) return null
      const target = this.target(sessionId)
      return target ? this.read(target) : null
    },
    async setDraft(sessionId, text) {
      await globalThis.__promptStudioComposerGate
      if (globalThis.__promptStudioSetDraftFails) return false
      const target = this.target(sessionId)
      if (!target) return false
      this.writes.push({ sessionId, text })
      this.write(target, text)
      return true
    },
    inserts: [],
    // insertText appends a paragraph (block mode), keeping what is there.
    async insertText(sessionId, text, opts) {
      await globalThis.__promptStudioComposerGate
      if (globalThis.__promptStudioSetDraftFails) return false
      const target = this.target(sessionId)
      if (!target) return false
      this.inserts.push({ sessionId, text, mode: opts?.mode })
      const before = this.read(target)
      this.write(target, before ? before + String.fromCharCode(10) + text : text)
      return true
    },
    submit(sessionId, text) { this.submits.push({ sessionId, text }); return this.submitResult },
    focus(sessionId) { this.focuses.push(sessionId) }
  },
  notify: n => { notifications.push(n) },
  notifyError: (_e, message) => { notifications.push({ kind: 'error', message }) }
}
`
  writeFileSync(join(tmp, 'sdk.js'), LEGACY_SDK ? sdkSource.replace(/^export const (ListRow|ToggleRow) = .*\n/gm, '') : sdkSource)
  writeFileSync(join(tmp, 'entry.js'), `
export { default as plugin, SHORTCUTS } from ${JSON.stringify(process.env.PROMPT_STUDIO_PLUGIN || join(repo, 'desktop', 'plugin.js'))}
export { notifications, i18n, translate, $locale, host, sdkHasRows } from './sdk.js'
export { createRoot } from 'react-dom/client'
export { act } from 'react'
export { jsx } from 'react/jsx-runtime'
`)
  await esbuild.build({
    entryPoints: [join(tmp, 'entry.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: join(tmp, 'bundle.mjs'),
    nodePaths: [nodeModules],
    alias: { '@hermes/plugin-sdk': join(tmp, 'sdk.js') },
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'error'
  })
  const mod = await import(pathToFileURL(join(tmp, 'bundle.mjs')).href)
  if (LEGACY_SDK) assert.ok(mod.sdkHasRows === false, 'legacy SDK stub has no ListRow/ToggleRow')

  // Fixed test markup (no user content): a minimal Hermes composer skeleton.
  document.body.innerHTML = `
    <div data-slot="composer-root"><div data-slot="composer-surface">
      <div data-slot="composer-rich-input" role="textbox" contenteditable="true"></div>
    </div></div>
    <div id="top"></div><div id="actions"></div>`
  const slots = {}
  const store = new Map()
  const storage = {
    sets: [],
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    set(key, value) { this.sets.push(key); store.set(key, value) },
    remove: key => store.delete(key),
    clear: () => store.clear()
  }
  const listeners = []
  const disposers = []
  const timers = []
  const addSpy = { window: 0, document: 0 }
  const realWindowAdd = window.addEventListener.bind(window)
  const realDocumentAdd = document.addEventListener
  window.addEventListener = (...args) => { addSpy.window += 1; return realWindowAdd(...args) }
  document.addEventListener = (...args) => { addSpy.document += 1; return realDocumentAdd.apply(document, args) }
  const pluginContext = {
    i18n: { register(bundles) { Object.assign(mod.i18n.bundles, bundles); return () => {} }, t: mod.translate, onLocaleChange: () => () => {} },
    storage,
    addEventListener(target, type, listener, options) {
      listeners.push({ target, type, options })
      ;(target === window ? realWindowAdd : realDocumentAdd.bind(target))(type, listener, options)
      const off = () => target.removeEventListener(type, listener, options)
      disposers.push(off)
      return off
    },
    // Host-tracked timer, as the SDK's ctx.setTimeout: returns a disposer; records every call.
    setTimeout(fn, ms) {
      const timer = { ms, fired: false, cleared: false, clear: null }
      const id = setTimeout(() => { timer.fired = true; fn() }, ms)
      timers.push(timer)
      const clear = () => { if (!timer.fired) timer.cleared = true; clearTimeout(id) }
      timer.clear = clear
      disposers.push(clear)
      return clear
    },
    onDispose(fn) { disposers.push(fn) },
    os: { clipboard: [], async writeClipboard(text) { if (globalThis.__promptStudioClipboardFails) return false; this.clipboard.push(text); return true } },
    registerMany(items) { for (const item of items) slots[item.area] = item },
    async rest(path, { body }) {
      backend.calls.push({ path, body })
      const handler = path === '/suggest' ? backend.suggest : path === '/compose' ? backend.compose : path === '/context' ? backend.context : null
      if (!handler) throw new Error(`HTTP 404 ${path}`)
      return handler(body)
    }
  }
  mod.plugin.register(pluginContext)
  window.addEventListener = realWindowAdd
  document.addEventListener = realDocumentAdd
  const roots = [mod.createRoot(document.getElementById('top')), mod.createRoot(document.getElementById('actions'))]
  await mod.act(async () => {
    roots[0].render(mod.jsx(() => slots.top.render(), {}))
    roots[1].render(mod.jsx(() => slots.actions.render(), {}))
  })
  ui = { ...mod, roots, dom, storage, listeners, addSpy, slots, disposers, timers, pluginContext }
})

after(async () => {
  if (ui) {
    await ui.act(async () => { for (const root of ui.roots) root.unmount() })
    ui.dom.window.close()
  }
  for (const port of openPorts) port.close()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------- helpers
const $ = sel => document.querySelector(sel)
// Compare DOM nodes with assert.ok(x === y), never assert.equal(node, ...): when that fails, node's
// assertion diff walks the whole jsdom graph and takes gigabytes of memory (froze the host once).
const draft = () => $('[data-slot="composer-rich-input"]').textContent
const tick = () => ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
// Bounded settle: a few macrotask ticks inside act(). Used only after generic actions (click/press)
// and where a test proves something does NOT happen (no extra call, late answer ignored): there is
// no positive condition to wait for, so we let pending work run for a fixed number of ticks.
async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) await tick()
}
// Re-check `condition` after each act() tick until it is truthy; fail loudly on timeout.
async function waitFor(condition, { timeout = 2000, label = condition.toString() } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    let value
    try { value = condition() } catch { value = false }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeout} ms: ${label}`)
    await tick()
  }
}
// The AI row for the step on screen finished: its /suggest was sent and is no longer loading.
const aiReady = () => field() && suggestFields().at(-1) === field() && !$('[data-studio-ai-loading]')
const notLoading = () => !$('[data-studio-ai-loading]')
async function click(sel) {
  const el = $(sel)
  assert.ok(el, `missing ${sel}`)
  assert.equal(el.disabled, false, `${sel} is disabled`)
  await ui.act(async () => { el.click() })
  await settle()
}
async function typeAnswer(text) {
  const input = $('[data-studio-answer-input]')
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
  await ui.act(async () => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const currentText = () => $('[data-studio-current-text]')?.textContent || ''
// Field id of the step on screen (language-independent; the question wording belongs to the core).
const field = () => $('[data-studio-field]')?.getAttribute('data-studio-field') || ''
const stepLabel = () => $('[data-studio-step]')?.textContent || ''
const suggestFields = () => backend.calls.filter(c => c.path === '/suggest').map(c => c.body.field.id)

const aiMode = () => $('[data-studio-ai-toggle]')?.getAttribute('data-studio-ai-state')
async function setMode(mode) {
  if (aiMode() !== mode) await click(`[data-studio-ai-mode-option="${mode}"]`)
}
// The deliverable step is always asked first (#23). Most tests are about the steps after it, so by default it is
// answered with its recommendation here and the backend call log is cleared; pass { deliverable: true } to stay on it.
async function openStudio(intent = INTENT, mode = 'auto', { deliverable = false } = {}) {
  $('[data-slot="composer-rich-input"]').textContent = intent
  // The AI mode is remembered across openings (as in the app); tests pick it with the selector.
  await click('[data-studio-open]')
  if (aiMode() !== mode) {
    const beforeOpen = backend.calls.length
    await setMode(mode)
    await click('[data-studio-cancel]')
    backend.calls.length = beforeOpen
    $('[data-slot="composer-rich-input"]').textContent = intent
    await click('[data-studio-open]')
  }
  if (!deliverable) await acceptDeliverable()
}
async function acceptDeliverable() {
  if (field() !== 'deliverable') return
  await waitFor(() => $('[data-studio-recommend]') && notLoading())
  await click('[data-studio-recommend]')
  await waitFor(() => field() !== 'deliverable')
  await settle()
  // The deliverable step's own /suggest is not part of what the tests count.
  backend.calls.splice(0, backend.calls.length, ...backend.calls.filter(c => !(c.path === '/suggest' && c.body.field.id === 'deliverable')))
}
// Generate, then accept the preview so the prompt lands in the composer.
async function generateAndUse() {
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview]'))
  assert.ok($('[data-studio-preview]'), 'preview shown before the composer changes')
  await click('[data-studio-use-prompt]')
}
// Answer the paste step ("Tem um texto de referência para colar?"): paste `text` or say "Não tenho".
async function pasteStep(text) {
  await acceptDeliverable() // the deliverable step comes first when the test did not go through openStudio
  assert.equal(field(), 'thirdPartyText')
  if (!text) return click('[data-studio-skip]')
  await click('[data-studio-paste-open]')
  await typeAnswer(text)
  await click('[data-studio-confirm]')
}
// Answer the current step: use the AI suggestion when there is one, otherwise skip/recommend.
async function answerStep() {
  if ($('[data-studio-paste-open]')) await pasteStep('E-mail do cliente: quero ver o total por mês.')
  else if ($('[data-studio-ai-use]')) {
    await click('[data-studio-ai-use]')
    if ($('[data-studio-answer-input]')?.value && $('[data-studio-confirm]')) await click('[data-studio-confirm]')
  } else if ($('[data-studio-recommend]')) await click('[data-studio-recommend]')
  else await click('[data-studio-skip]')
}

beforeEach(async () => {
  if (skip) return
  if ($('[data-studio-cancel]')) await click('[data-studio-cancel]')
  backend.calls.length = 0
  ui.notifications.length = 0
  backend.suggest = body => ({ ok: true, value: body.field.kind === 'enum' ? body.field.recommended : `sugestão para ${body.field.id}`, reason: 'teste' })
  backend.compose = body => ({ ok: true, prompt: `PROMPT DA IA (${body.answers.length} respostas)`, notes: 'ok' })
  backend.context = () => ({ ok: true, summary: 'RESUMO DA SESSAO', model: 'anthropic/claude-haiku-5', turns: 8, ms: 1432 })
  localStorage.clear()
  $('[data-slot="composer-rich-input"]').textContent = ''
})

// ---------------------------------------------------------------- tests
test('AI recommendation runs by itself on every step (no click), and removed steps never show up', { skip }, async () => {
  await openStudio()
  assert.equal(aiMode(), 'auto')
  const seen = []
  // The paste step comes first and never calls the AI: only the user knows if they have a text.
  await settle() // intentional: proves no /suggest is sent on the paste step
  assert.equal(suggestFields().length, 0, 'no /suggest on the paste step')
  assert.ok($('[data-studio-ai-row]') === null, 'no AI row on the paste step')
  await answerStep()
  for (let guard = 0; guard < 20 && $('[data-studio-step]'); guard += 1) {
    await waitFor(aiReady)
    const before = suggestFields().length
    await settle() // intentional: proves no extra /suggest after the step's one
    const field = backend.calls.filter(c => c.path === '/suggest').at(-1)?.body.field.id
    assert.equal(suggestFields().length, before, 'no extra /suggest after settling')
    assert.ok($('[data-studio-ai-row]'), `AI row visible on "${currentText()}"`)
    assert.match(stepLabel(), /^Step \d+$/)
    assert.ok($('[role="progressbar"]'), 'progress bar shown')
    seen.push(field)
    await answerStep()
  }
  assert.deepEqual(suggestFields(), seen, 'exactly one automatic /suggest per step, in step order')
  // Something was pasted, so "De onde veio esse texto?" follows; the AI sees the pasted text from here on.
  assert.deepEqual(seen, ['thirdPartySource', 'context', 'requirements', 'success', 'designAvoid', 'autonomy', 'subagents', 'format', 'length'])
  assert.match(backend.calls.find(c => c.path === '/suggest').body.ladder.find(r => r.category === 'thirdPartyText').answer, /E-mail do cliente/)
  for (const removed of REMOVED) assert.ok(!seen.includes(removed), `${removed} must not be asked`)
  assert.equal(new Set(seen).size, seen.length, 'no step asked twice')
  assert.match(currentText(), /All steps answered/)
  assert.ok($('[data-studio-ai-row]') === null, 'no AI row once every step is answered')
})

test('"Generate prompt with AI" sends every accumulated answer to /compose and places the AI prompt', { skip }, async () => {
  await openStudio()
  for (let i = 0; i < 4; i += 1) await answerStep() // thirdPartyText, thirdPartySource, context, requirements
  await waitFor(aiReady)
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview-text]'))
  assert.equal(draft(), '', 'nothing in the composer before the preview is accepted')
  assert.match($('[data-studio-preview-text]').textContent, /PROMPT DA IA/)
  await click('[data-studio-switch-version]')
  assert.ok($('[data-studio-preview-text]').textContent.length > 100, 'version without AI available')
  await click('[data-studio-switch-version]')
  await click('[data-studio-use-prompt]')
  const compose = backend.calls.filter(c => c.path === '/compose')
  assert.equal(compose.length, 1)
  const body = compose[0].body
  assert.equal(body.intent, INTENT)
  assert.deepEqual(body.answers.map(a => a.id), ['deliverable', 'thirdPartyText', 'thirdPartySource', 'context', 'requirements'])
  assert.match(body.answers[1].answer, /E-mail do cliente/)
  assert.match(body.answers[3].answer, /sugestão para context/)
  assert.ok(body.baseline.length > 100, 'site-engine baseline goes along')
  assert.equal(draft(), 'PROMPT DA IA (5 respostas)')
  assert.ok($('[data-studio-current-text]') === null, 'studio closed after using the prompt')
})

test('AI failures never block the flow: /suggest error still lets you answer; /compose error falls back to the site engine', { skip }, async () => {
  backend.suggest = () => { throw new Error('HTTP 502 upstream') }
  backend.compose = () => { throw new Error('HTTP 502 upstream') }
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.match($('[data-studio-ai-error]').textContent, /Could not reach the AI/, 'error shown on the AI row in plain words')
  assert.match($('[data-studio-ai-error]').getAttribute('title'), /502/, 'detail kept in the tooltip')
  const first = currentText()
  await click('[data-studio-skip]')
  assert.notEqual(currentText(), first, 'advanced to the next step despite the AI error')
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview-note]'))
  assert.match($('[data-studio-preview-note]').textContent, /version without AI/, 'failure explained in the preview')
  assert.ok($('[data-studio-switch-version]') === null, 'only one version to show')
  await click('[data-studio-use-prompt]')
  assert.ok(draft().length > 100, 'engine prompt placed in the composer')
  assert.notEqual(draft(), 'PROMPT DA IA (2 respostas)')
})

test('an empty model reply (e.g. provider safety filter) says the model gave no answer, not that the AI is unreachable', { skip }, async () => {
  backend.suggest = () => ({ ok: false, empty: true, error: 'a IA devolveu uma resposta vazia (o filtro do provedor pode ter barrado o pedido)' })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  const error = $('[data-studio-ai-error]')
  assert.match(error.textContent, /The model did not answer/)
  assert.doesNotMatch(error.textContent, /Could not reach/)
  assert.match(error.getAttribute('title'), /vazia/, 'detail kept in the tooltip')
  const first = currentText()
  await click('[data-studio-skip]')
  assert.notEqual(currentText(), first, 'the flow keeps going')
})

test('Cancelar while the AI writes restores the draft and a late answer is ignored', { skip }, async () => {
  let release
  backend.compose = () => new Promise(resolve => { release = () => resolve({ ok: true, prompt: 'TARDE DEMAIS' }) })
  await openStudio()
  await click('[data-studio-generate]')
  assert.match(document.getElementById('top').textContent, /writing the prompt/)
  await click('[data-studio-cancel]')
  assert.equal(draft(), INTENT, 'original draft back')
  release()
  await settle() // intentional: proves the late /compose answer is ignored
  assert.equal(draft(), INTENT, 'late /compose answer did not overwrite the draft')
})

test('Voltar keeps answers and reuses the cached suggestion (no second call); off mode makes no AI calls', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-use]'))
  await answerStep()
  const calls = suggestFields().length
  await click('[data-studio-back]')
  assert.equal(field(), 'context')
  assert.equal(suggestFields().length, calls, 'cached suggestion reused')
  // AI off: cycle the toggle until off, then walk and generate with zero AI calls.
  await setMode('off')
  backend.calls.length = 0
  await click('[data-studio-skip]')
  await generateAndUse()
  assert.equal(backend.calls.length, 0, 'no /suggest nor /compose with AI off')
  assert.ok(draft().length > 100, 'engine prompt used directly')
  assert.equal(ui.storage.get('aiMode'), 'off', 'choice persisted in ctx.storage')
  assert.equal(localStorage.length, 0, 'nothing in raw localStorage')
})

test('vague draft: the deliverable is asked first, every offered option is safe to pick', { skip }, async () => {
  await openStudio(VAGUE, 'auto', { deliverable: true })
  await waitFor(() => suggestFields().length > 0 && $('[data-studio-option]'))
  assert.equal(field(), 'deliverable')
  assert.equal(backend.calls.filter(c => c.path === '/suggest').at(-1)?.body.field.id, 'deliverable')
  const offered = [...document.querySelectorAll('[data-studio-option]')].map(el => el.getAttribute('data-studio-option'))
  assert.ok(offered.length >= 6, `offered ${offered.length}`)
  const plan = offered.find(label => /^(Plano|Plan)\b/i.test(label))
  assert.ok(plan, `a plan option among ${offered.join(' | ')}`)
  await click(`[data-studio-option="${plan}"]`)
  assert.equal(field(), 'thirdPartyText')
  await setMode('off')
  await generateAndUse()
  assert.ok(draft().length > 100, 'engine prompt placed, no conflict error')
  assert.ok(!ui.notifications.some(n => /contradict/.test(n.message)))
})

test('a draft the engine misreads still gets the deliverable step with all nine options', { skip }, async () => {
  for (const draftText of ['Como funciona o cron do Linux?', 'Create a plan for the product launch']) {
    await openStudio(draftText, 'off', { deliverable: true })
    assert.equal(field(), 'deliverable', draftText)
    assert.equal(document.querySelectorAll('[data-studio-option], [data-studio-recommend]').length, 9, `${draftText}: every deliverable offered`)
    await click('[data-studio-cancel]')
  }
})

test('a deliverable that contradicts the draft is kept and its conflict note is shown in the preview (Codex P2)', { skip }, async () => {
  await openStudio('Create a plan for the product launch', 'off', { deliverable: true })
  assert.equal(field(), 'deliverable')
  const plan = [...document.querySelectorAll('[data-studio-option]')].map(el => el.getAttribute('data-studio-option')).find(label => /^(Plano|Plan)\b/i.test(label))
  assert.ok(plan, 'the plan option is offered although the engine read the draft as an implementation')
  await click(`[data-studio-option="${plan}"]`)
  assert.equal(field(), 'thirdPartyText')
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview-warning]'))
  assert.match($('[data-studio-preview-warning]').textContent, /contradicts what the draft asks for/, 'the conflict reaches the preview with the AI off')
  await click('[data-studio-use-prompt]')
  assert.ok(draft().length > 100, 'the prompt built for the chosen deliverable is placed')
})

test('the conflict note is in the Studio language and stays when switching preview versions (Codex P2 round 2)', { skip }, async () => {
  ui.i18n.locale = 'pt'
  await ui.act(async () => { ui.$locale.set('pt') })
  try {
    await openStudio('Create a plan for the product launch', 'auto', { deliverable: true })
    await waitFor(() => $('[data-studio-option]') && notLoading())
    const plan = [...document.querySelectorAll('[data-studio-option]')].map(el => el.getAttribute('data-studio-option')).find(label => /^Plano\b/.test(label))
    assert.ok(plan, 'the Portuguese plan option is offered')
    await click(`[data-studio-option="${plan}"]`)
    await pasteStep('')
    await click('[data-studio-generate]')
    await waitFor(() => $('[data-studio-preview-text]') && $('[data-studio-switch-version]'))
    assert.match($('[data-studio-preview-text]').textContent, /PROMPT DA IA/, 'AI version shown first')
    const warning = () => $('[data-studio-preview-warning]')?.textContent || ''
    assert.match(warning(), /contradiz o que o rascunho pede/, 'warning in Portuguese on the AI version')
    assert.doesNotMatch(warning(), /reads as|contradicts what/, 'no hard-coded English engine note')
    assert.match(warning(), /Plano \/ roteiro/, 'the option label is translated too')
    await click('[data-studio-switch-version]')
    assert.match($('[data-studio-preview-title]').textContent, /sem IA/, 'engine version shown')
    assert.match(warning(), /contradiz o que o rascunho pede/, 'warning still shown on the version without AI')
    await click('[data-studio-cancel]')
  } finally {
    ui.i18n.locale = 'en'
    await ui.act(async () => { ui.$locale.set('en') })
  }
})

test('an empty AI suggestion on a step with a default offers "Use the recommended"; with no default only the step’s own Skip remains', { skip }, async () => {
  backend.suggest = () => ({ ok: true, value: '', reason: 'nada a acrescentar' })
  await openStudio()
  await pasteStep('')
  await waitFor(aiReady)
  for (let guard = 0; guard < 20 && $('[data-studio-step]'); guard += 1) {
    await waitFor(aiReady)
    const row = $('[data-studio-ai-row]')?.textContent || ''
    const use = $('[data-studio-ai-use]')
    const skips = [...document.querySelectorAll('[data-studio-strip] button')].filter(b => /^Skip/.test(b.textContent))
    // With a recommended value the message and F7 offer it; with no default the step's own Skip (F6)
    // is the only skip button (U8: two keys doing the same thing under the same label confused users).
    if ($('[data-studio-options]') && $('[data-studio-recommend]')) {
      // Enum: the AI endorsed the default, which is the one recommended button (F5); no F7 twin.
      assert.equal(use, null, `no F7 on the choice step "${currentText()}"`)
      assert.match($('[data-studio-recommend]').textContent, /Recommended by AI/)
      await click('[data-studio-recommend]')
    } else if ($('[data-studio-recommend]')) {
      assert.ok(use, `no way forward from the AI row on "${currentText()}"`)
      assert.doesNotMatch(row, /skip/i, `"${currentText()}" says skip but has a default`)
      assert.match(use.textContent, /Use the recommended/)
      await click('[data-studio-ai-use]')
    } else {
      assert.equal(use, null, `no F7 "Skip" twin on "${currentText()}"`)
      assert.equal(skips.length, 1, 'exactly one Skip button')
      assert.match(row, /nothing to add/)
      await click('[data-studio-skip]')
    }
  }
  assert.ok(!$('[data-studio-step]'), 'walked every step with the AI button only')
})

test('UI hierarchy: one primary action per step, Generate secondary until the end, one close control, AI card is live', { skip }, async () => {
  const isPrimary = el => /font-weight: 600/.test(el.getAttribute('style') || '')
  await openStudio()
  await waitFor(() => $('[data-studio-skip]'))
  assert.ok($('[data-studio-open]') === null, 'composer button hidden while open (Cancel closes)')
  assert.match($('[data-studio-generate]').textContent, /^Generate now(F9)?$/)
  assert.ok(!isPrimary($('[data-studio-generate]')), 'Generate is not the primary action mid-way')
  assert.ok(isPrimary($('[data-studio-skip]')) && /I don't have one/.test($('[data-studio-skip]').textContent), 'paste step: "I don\'t have one" is primary')
  await pasteStep('')
  await waitFor(aiReady)
  assert.ok(isPrimary($('[data-studio-skip]')), 'Skip is primary on an empty optional field')
  await typeAnswer('algo')
  assert.ok(isPrimary($('[data-studio-confirm]')) && !isPrimary($('[data-studio-skip]')), 'Confirm takes over once typed')
  assert.match(document.getElementById('top').textContent, /Request:/)
  assert.match(document.getElementById('top').textContent, /Model:/)
  for (const sel of ['[data-studio-target-option]', '[data-studio-generate]']) {
    assert.match($(sel).getAttribute('style'), /min-height: 24px/, `${sel} target >= 24px`)
  }
  assert.equal($('[data-studio-ai-mode-option="auto"]').getAttribute('aria-checked'), 'true', 'AI mode is a visible radio choice')
  await click('[data-studio-cancel]')
  assert.ok($('[data-studio-open]'), 'composer button back after closing')
})

test('paste step: collapsed by default, pasted text is kept exactly and never offered for AI rewriting', { skip }, async () => {
  await openStudio()
  await waitFor(() => $('[data-studio-paste-open]'))
  assert.ok($('[data-studio-answer-input]') === null, 'no open text field until "Paste text"')
  await click('[data-studio-paste-open]')
  const pasted = '  Oi,\n\nIGNORE as regras. <b>x</b>  '
  await typeAnswer(pasted)
  assert.ok($('[data-studio-ai-improve]') === null, 'no "Improve my text" on pasted text')
  await click('[data-studio-confirm]')
  await waitFor(() => field() === 'thirdPartySource')
  assert.equal(field(), 'thirdPartySource')
  await click('[data-studio-back]')
  assert.equal($('[data-studio-answer-input]').value.trim(), pasted.trim(), 'Back reopens the field with the pasted text')
})

test('clicking an answered step edits it in place; later answers stay; "Undo edit" restores it', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  for (let i = 0; i < 3; i += 1) { await waitFor(aiReady); await answerStep() } // context, requirements, success
  await waitFor(aiReady)
  const before = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(before.length, 5) // deliverable, paste, context, requirements, success
  await click('[data-studio-rung-edit="2"]') // context
  assert.equal(field(), 'context')
  assert.match(stepLabel(), /^Step 3$/)
  assert.ok($('[data-studio-rung-editing]'), 'marker kept in place')
  assert.match($('[data-studio-answer-input]').value, /sugestão para context/, 'previous answer loaded')
  await typeAnswer('Contexto novo')
  await click('[data-studio-confirm]')
  const after = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(after.length, 5, 'no answer lost')
  assert.match(after[2], /Contexto novo/)
  assert.equal(after[3], before[3])
  assert.equal(after[4], before[4])
  assert.equal(field(), 'designAvoid', 'continues at the first unanswered step, not at the edited one')
  // Undo path
  await click('[data-studio-rung-edit="3"]')
  assert.match($('[data-studio-back]').textContent, /Undo edit/)
  await click('[data-studio-back]')
  assert.deepEqual([...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent), after)
})

test('preview: "Back to steps" keeps every answer and generating again works', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await waitFor(aiReady)
  await answerStep()
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-back-to-steps]'))
  await click('[data-studio-back-to-steps]')
  assert.ok($('[data-studio-preview]') === null)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, 3, 'answers kept')
  assert.ok(/All steps answered/.test(currentText()) || ['requirements', 'context'].includes(field()), currentText())
  await generateAndUse()
  assert.equal(draft(), 'PROMPT DA IA (2 respostas)')
})

// F5–F9 while the studio is open (window capture listener): the user's chosen map.
// The shortcut map the UI is built from (exported by plugin.js): tests assert against it, never against literals.
const K = () => ui.SHORTCUTS
// An errors.* message as shown: the ones that point to Settings take the settings key.
const errorText = (code, locale = 'en') => {
  const message = ui.i18n.bundles[locale].errors[code]
  return typeof message === 'function' ? message(K().settings) : message
}
const digit = (action, n) => K()[action].replace('1…9', String(n))
async function press(combo, target = document.activeElement || document.body, extra = {}) {
  const parts = combo.split('+')
  const key = parts.pop()
  const mods = { altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') }
  const code = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
  const event = new ui.dom.window.KeyboardEvent('keydown', { key: mods.shiftKey && /^[0-9]$/.test(key) ? '!' : key.toLowerCase().length === 1 ? key.toLowerCase() : key, code, bubbles: true, cancelable: true, ...mods, ...extra })
  await ui.act(async () => { target.dispatchEvent(event) })
  await settle()
  return event
}

test('keys F5–F9 press the step buttons, also with the cursor in the answer field; closed studio leaves keys alone', { skip }, async () => {
  // Closed: F5 is not taken (the app keeps its own behaviour).
  assert.equal((await press(K().accept)).defaultPrevented, false)
  await openStudio(INTENT, 'off')
  // Paste step: F6 = "I don't have one" (skip).
  assert.equal(field(), 'thirdPartyText')
  assert.equal($('[data-studio-skip] [data-studio-key]')?.textContent, K().skip, 'key shown on the button')
  await press(K().skip)
  // Context step (text, no default): F5 does nothing until something is typed, F6 skips.
  assert.equal(field(), 'context')
  const input = $('[data-studio-answer-input]')
  await typeAnswer('Uso pessoal, só eu')
  input.focus()
  const typed = await press(K().accept, input)
  assert.equal(typed.defaultPrevented, true, 'works with the cursor in the field')
  let rungs = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(rungs.length, 3)
  assert.match(rungs[2], /Uso pessoal/)
  // F8 = Back, F5 on a step with a recommendation = accept it.
  const before = currentText()
  await press(K().back)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, 2)
  await press(K().skip)
  assert.equal(currentText(), before)
  for (let i = 0; i < 8 && !$('[data-studio-recommend]'); i += 1) await press(K().skip)
  const recommended = $('[data-studio-recommend]')
  assert.ok(recommended, 'reached a step with a recommendation')
  assert.equal(recommended.querySelector('[data-studio-key]')?.textContent, K().accept)
  const count = document.querySelectorAll('[data-studio-rung]').length
  const question = currentText()
  await press(K().accept)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, count + 1)
  assert.notEqual(currentText(), question)
  // Modifiers are not ours (Cinnamon uses Alt+F5/F7/F8).
  assert.equal((await press(K().accept, document.body, { altKey: true })).defaultPrevented, false)
  // F9 = Generate now, then F9 = Send now, F8 in the preview = Back to steps.
  await press(K().generate)
  assert.ok($('[data-studio-preview]'))
  await press(K().back)
  assert.ok($('[data-studio-preview]') === null)
  ui.host.composer.submits.length = 0
  await press(K().generate)
  await press(K().generate)
  assert.ok($('[data-studio-strip]') === null, 'studio closed after sending the prompt')
  assert.equal(ui.host.composer.submits.length, 1, 'prompt sent')
  assert.ok(ui.host.composer.submits[0].text.length > 50, 'the whole prompt was sent')
  assert.equal((await press(K().generate)).defaultPrevented, false, 'listener removed when closed')
})

test('F7 uses the AI suggestion', { skip }, async () => {
  await openStudio()
  await press(K().skip)
  await waitFor(aiReady)
  const use = $('[data-studio-ai-use]')
  assert.ok(use, 'AI card ready')
  assert.equal(use.querySelector('[data-studio-key]')?.textContent, K().useAi)
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press(K().useAi)
  if ($('[data-studio-answer-input]')?.value) await press(K().accept)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, n + 1)
})

// Every clickable control in the open studio shows a key, the key is unique on screen, and the
// key cap text is exactly the combo it runs.
function assertEverythingHasAKey() {
  const strip = $('[data-studio-strip]')
  const controls = [...strip.querySelectorAll('button')].filter(b => !b.disabled)
  const missing = controls.filter(b => !b.getAttribute('data-studio-shortcut') && !b.hasAttribute('data-studio-ai-mode-option'))
  assert.ok(strip.querySelector('[data-studio-shortcuts-help]'), 'Shortcuts control on screen')
  assert.deepEqual(missing.map(b => b.textContent), [], 'every enabled button has a key')
  const combos = controls.map(b => b.getAttribute('data-studio-shortcut')).filter(Boolean)
  assert.equal(new Set(combos).size, combos.length, `no key twice on screen: ${combos.join(' ')}`)
  for (const b of controls.filter(b => b.getAttribute('data-studio-shortcut') && !b.hasAttribute('data-studio-ai-mode-option'))) {
    assert.equal(b.querySelector('[data-studio-key]')?.textContent, b.getAttribute('data-studio-shortcut'), `key printed on "${b.textContent}"`)
  }
  if (strip.querySelector('[data-studio-ai-toggle]')) assert.equal(strip.querySelector('[data-studio-ai-toggle] [data-studio-key]')?.textContent, K().mode)
}

test('absolutely everything has a key: F4 opens, F10 closes, Alt+digit picks, Alt+Shift+digit edits, Alt+letters for the rest', { skip }, async () => {
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  assert.equal($('[data-studio-open] [data-studio-key]')?.textContent, K().open, 'F4 printed on the open button')
  await press(K().open)
  assert.ok($('[data-studio-strip]'), 'F4 opened the studio')
  await press(K().close)
  assert.ok($('[data-studio-strip]') === null, 'F10 closed it')
  assert.equal(draft(), INTENT, 'draft returned')
  await openStudio(INTENT, 'manual')
  assertEverythingHasAKey()
  await press(K().paste)
  assert.ok($('[data-studio-answer-input]'), 'Alt+C opened the paste field')
  await press(K().close)
  await openStudio(INTENT, 'manual')
  await press(K().skip)
  assertEverythingHasAKey()
  // Alt+S asks the AI, Alt+D discards, Alt+N asks again, F7 uses it.
  await press(K().ask); await waitFor(() => $('[data-studio-ai-use]'))
  assert.ok($('[data-studio-ai-use]'))
  assertEverythingHasAKey()
  await press(K().discard)
  assert.ok($('[data-studio-ai-use]') === null)
  await press(K().ask); await waitFor(() => $('[data-studio-ai-use]'))
  const before = backend.calls.filter(c => c.path === '/suggest').length
  await press(K().another); await waitFor(() => backend.calls.filter(c => c.path === '/suggest').length > before && $('[data-studio-ai-use]'))
  assert.equal(backend.calls.filter(c => c.path === '/suggest').length, before + 1)
  await press(K().useAi)
  assertEverythingHasAKey()
  // Alt+M improves what is in the field; then F5 confirms.
  assert.ok($('[data-studio-ai-improve]'))
  const beforeImprove = suggestFields().length
  await press(K().improve); await waitFor(() => suggestFields().length > beforeImprove && notLoading())
  await press(K().accept)
  // Enum step: walk until one appears, Alt+1 picks the first non-recommended option.
  for (let i = 0; i < 10 && !$('[data-studio-options] [data-studio-option]'); i += 1) await press($('[data-studio-skip]') ? K().skip : K().accept)
  const first = $('[data-studio-options] [data-studio-option]')
  assert.ok(first, 'reached an options step')
  assertEverythingHasAKey()
  const label = first.getAttribute('data-studio-option')
  await press(digit('pick', 1))
  const rungs = [...document.querySelectorAll('[data-studio-rung]')]
  assert.match(rungs.at(-1).textContent, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  // Alt+Shift+2 edits step 2; F8 undoes the edit.
  await press(digit('edit', 2))
  assert.ok($('[data-studio-rung-editing]'))
  await press(K().back)
  assert.ok($('[data-studio-rung-editing]') === null)
  // Alt+A / Alt+O switch the model, Alt+I cycles the AI mode.
  await press(K().model.astra)
  assert.equal($('[data-studio-target-option="astra"]').getAttribute('aria-checked'), 'true')
  await press(K().model.sonnet)
  assert.equal($('[data-studio-target-option="sonnet"]').getAttribute('aria-checked'), 'true')
  await press(K().model.opus)
  assert.equal($('[data-studio-target-option="opus"]').getAttribute('aria-checked'), 'true')
  const mode = aiMode()
  await press(K().mode)
  assert.notEqual(aiMode(), mode)
  await setMode('auto')
  // Preview: Alt+V switches versions, F8 back to steps, F9 uses the prompt.
  await press(K().generate); await waitFor(() => $('[data-studio-preview]'))
  assert.ok($('[data-studio-preview]'))
  assertEverythingHasAKey()
  if ($('[data-studio-switch-version]')) {
    const heading = $('[data-studio-preview-title]').textContent
    await press(K().version)
    assert.notEqual($('[data-studio-preview-title]').textContent, heading)
  }
  await press(K().generate)
  assert.ok($('[data-studio-strip]') === null)
  // Closed studio: Alt+letters and F5–F10 belong to the app again.
  for (const combo of [K().accept, K().close, K().ask, digit('pick', 1)]) assert.equal((await press(combo)).defaultPrevented, false, combo)
  // Ctrl/Super chords are never taken.
  await openStudio(INTENT, 'off')
  assert.equal((await press(K().skip, document.body, { ctrlKey: true })).defaultPrevented, false)
  assert.equal((await press(K().ask, document.body, { metaKey: true })).defaultPrevented, false)
})


test('SHORTCUT MAP: every key cap, aria-keyshortcuts, target key and Alt+Shift edit key on screen is a combo of the map', { skip }, async () => {
  const map = K()
  const flat = []
  const walk = value => { if (typeof value === 'string') flat.push(value); else Object.values(value).forEach(walk) }
  walk(map)
  const allowed = new Set([...flat, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [digit('pick', n), digit('edit', n)])])
  assert.equal(new Set(flat.filter(c => !c.includes('…'))).size, flat.filter(c => !c.includes('…')).length, 'no combo twice in the map')
  await openStudio(INTENT, 'manual')
  for (let i = 0; i < 3 && !$('[data-studio-ladder]'); i += 1) await press(map.skip)
  assert.ok($('[data-studio-ladder]'), 'ladder with steps to edit')
  const strip = $('[data-studio-strip]')
  for (const cap of strip.querySelectorAll('[data-studio-key], [data-studio-key-reserved]')) {
    const combo = cap.getAttribute('data-studio-key') ?? cap.getAttribute('data-studio-key-reserved')
    assert.ok(allowed.has(combo), `${combo} comes from the map`)
    assert.equal(cap.textContent, combo, 'the cap prints its combo')
  }
  for (const el of strip.querySelectorAll('[aria-keyshortcuts], [data-studio-shortcut]')) {
    assert.ok(allowed.has(el.getAttribute('aria-keyshortcuts') ?? el.getAttribute('data-studio-shortcut')), 'shortcut attribute comes from the map')
  }
  // Target switch keys.
  for (const [id, combo] of Object.entries(map.model)) {
    const option = $(`[data-studio-target-option="${id}"]`)
    assert.ok(option, `${id} option on screen`)
    assert.equal(option.getAttribute('data-studio-shortcut'), combo)
    assert.equal(option.querySelector('[data-studio-key]')?.textContent, combo)
  }
  // Edit keys on the ladder: Alt+Shift+n of the map, one per step.
  const edits = [...strip.querySelectorAll('[data-studio-ladder] [data-studio-key]')].map(cap => cap.textContent)
  assert.ok(edits.length > 0)
  edits.forEach((combo, i) => assert.equal(combo, digit('edit', i + 1), `step ${i + 1} edit key`))
  // The cap on every control is the combo it runs: pressing the map's combo clicks that control.
  assert.equal($('[data-studio-skip] [data-studio-key]')?.textContent, map.skip)
  assert.equal($('[data-studio-shortcuts-help] [data-studio-key]')?.textContent, map.help)
  assert.equal($('[data-studio-settings] [data-studio-key]')?.textContent, map.settings)
  assert.equal($('[data-studio-cancel] [data-studio-key]')?.textContent, map.close)
  assert.equal($('[data-studio-ai-toggle] [data-studio-key]')?.textContent, map.mode)
  await press(map.close)
})

test('SHORTCUT MAP: texts that teach a key (tooltip, notices, notes, errors) print the map\'s combo, en and pt', { skip }, async () => {
  const original = structuredClone(K())
  const swapped = { open: 'F11', settings: 'F12', generate: 'F2', mode: 'Alt+Z', pick: 'Option+1…9' }
  const stale = /\b(F4|F3|F9)\b|Alt\+I|Alt\+digit/
  try {
    for (const locale of ['en', 'pt']) {
      Object.assign(ui.SHORTCUTS, original)
      await freshSettings('sess-1')
      ui.i18n.locale = locale
      await ui.act(async () => { ui.$locale.set(locale) })
      Object.assign(ui.SHORTCUTS, swapped)
      const map = K()
      // The "write your request first" notice names the key that opens the studio.
      $('[data-slot="composer-rich-input"]').textContent = ''
      ui.notifications.length = 0
      await click('[data-studio-open]')
      const empty = ui.notifications.at(-1)?.message ?? ''
      assert.ok(empty.includes(map.open) && !stale.test(empty), `${locale}: empty-draft notice names ${map.open}: ${empty}`)
      // The AI-mode tooltip, the done state and the notes under F1.
      await openStudio(INTENT, 'off')
      const tip = $('[data-studio-ai-toggle] span[title]').getAttribute('title')
      assert.ok(tip.includes(map.mode) && !stale.test(tip), `${locale}: tooltip names ${map.mode}: ${tip}`)
      for (let i = 0; i < 20 && $('[data-studio-step]'); i += 1) await press($('[data-studio-skip]') ? original.skip : original.accept)
      assert.ok(currentText().includes(`(${map.generate})`) && !stale.test(currentText()), `${locale}: done state names ${map.generate}: ${currentText()}`)
      if (!$('[data-studio-shortcuts-list]')) await press(map.help)
      const notes = $('[data-studio-shortcuts-list]').textContent
      assert.ok(notes.includes('Option+') && !stale.test(notes), `${locale}: digit note follows the pick combo`)
      await press(map.help)
      // Provider errors point to Settings with the settings key.
      await freshSettings('sess-1')
      backend.context = () => ({ ok: false, code: 'provider_refused', error: 'provider refused: PermissionDeniedError' })
      await openFresh()
      await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(`(${map.settings})`))
      assert.ok(!stale.test($('[data-studio-context-status]').textContent), `${locale}: error names ${map.settings}`)
    }
  } finally {
    Object.assign(ui.SHORTCUTS, original)
    ui.i18n.locale = 'en'
    await ui.act(async () => { ui.$locale.set('en') })
    if ($('[data-studio-cancel]')) await click('[data-studio-cancel]')
  }
})

test('SHORTCUT MAP: i18n-ui.js writes no key combo itself (every one comes in as an argument)', () => {
  const source = readFileSync(join(repo, 'desktop', 'src', 'i18n-ui.js'), 'utf8').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n')
  assert.deepEqual(source.match(/\bF(?:[1-9]|1[0-2])\b|\b(?:Alt|Ctrl|Shift)\+/g) ?? [], [], 'no F-key or modifier combo typed in the bundles')
})

// ---------------------------------------------------------------- v1.0.0 review fixes
const active = () => document.activeElement
const inStrip = () => Boolean($('[data-studio-strip]')?.contains(active()))

test('A1/H5: the key listener is registered through ctx.addEventListener, no bare window/document listener', { skip }, async () => {
  const keydown = ui.listeners.filter(l => l.type === 'keydown')
  assert.equal(keydown.length, 1, 'one tracked keydown listener')
  assert.equal(keydown[0].target, window)
  assert.equal(keydown[0].options, true, 'capture phase')
  assert.equal(ui.addSpy.window + ui.addSpy.document, 0, 'no bare addEventListener during register')
  const source = await import('node:fs').then(fs => fs.readFileSync(join(repo, 'desktop', 'plugin.js'), 'utf8'))
  const ui_part = source.slice(source.indexOf('// @studio-end'))
  assert.doesNotMatch(ui_part, /(window|document)\.addEventListener\(/)
  assert.doesNotMatch(source, /localStorage/, 'no raw localStorage at all')
})

test('A2/H5: preferences live in ctx.storage, never in localStorage', { skip }, async () => {
  ui.storage.sets.length = 0
  await openStudio(INTENT, 'off')
  await setMode('manual')
  await setMode('off')
  await click('[data-studio-target-option="astra"]')
  await click('[data-studio-target-option="opus"]')
  assert.deepEqual([...new Set(ui.storage.sets)].sort(), ['aiMode', 'target'])
  assert.equal(localStorage.length, 0)
})

test('i18n: en and pt bundles have the same keys; English is the default; pt follows the app locale', { skip }, async () => {
  const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort()
  const { UI_MESSAGES } = await import(pathToFileURL(join(repo, 'desktop', 'src', 'i18n-ui.js')).href)
  assert.deepEqual(keys(UI_MESSAGES.pt), keys(UI_MESSAGES.en))
  assert.deepEqual(keys(ui.i18n.bundles.en), keys(UI_MESSAGES.en), 'the inlined @ui-i18n block matches src/i18n-ui.js')
  await openStudio(INTENT, 'off')
  assert.match($('[data-studio-cancel]').textContent, /^Cancel/)
  ui.i18n.locale = 'pt'
  await ui.act(async () => { ui.$locale.set('pt') })
  await waitFor(() => /^Cancelar/.test($('[data-studio-cancel]').textContent))
  assert.match($('[data-studio-cancel]').textContent, /^Cancelar/)
  assert.match($('[data-studio-shortcuts-help]').textContent, /^Atalhos/)
  ui.i18n.locale = 'en'
  await ui.act(async () => { ui.$locale.set('en') })
  await waitFor(() => /^Cancel(?!ar)/.test($('[data-studio-cancel]').textContent))
})

test('U1: focus lands on the first logical target after every step and status change, never the composer', { skip }, async () => {
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  $('[data-slot="composer-rich-input"]').focus()
  await press(K().open)
  await waitFor(() => field() === 'deliverable' && $('[data-studio-recommend]') && notLoading())
  assert.ok(active() === ($('[data-studio-recommend]')), 'deliverable step: recommended option')
  await acceptDeliverable()
  await waitFor(() => $('[data-studio-paste-open]'))
  assert.ok(active() === ($('[data-studio-paste-open]')), 'paste step: "+ Paste text"')
  await press(K().paste)
  assert.ok(active() === ($('[data-studio-answer-input]')), 'paste field opened: textarea')
  await press(K().close)
  await openStudio(INTENT, 'manual')
  await press(K().skip)
  assert.ok(active() === ($('[data-studio-answer-input]')), 'text step: textarea')
  for (let i = 0; i < 10 && !$('[data-studio-options]'); i += 1) await press($('[data-studio-skip]') ? K().skip : K().accept)
  assert.ok($('[data-studio-options]'))
  assert.ok(active() === ($('[data-studio-recommend]') || $('[data-studio-option]')), 'choice step: recommended option')
  const beforeAsk = suggestFields().length
  await press(K().ask); await waitFor(() => suggestFields().length > beforeAsk && notLoading())
  await press(K().discard); await waitFor(() => !$('[data-studio-ai-discard]'))
  assert.ok(inStrip(), `after Discard focus stays in the studio (${active()?.tagName})`)
  await press(K().generate); await waitFor(() => $('[data-studio-send-prompt]'))
  assert.ok(active() === ($('[data-studio-send-prompt]')), 'preview: "Send now"')
  await press(K().back); await waitFor(() => !$('[data-studio-preview]'))
  assert.ok(inStrip(), 'back to steps keeps focus in the studio')
})

test('U3/U7: F1 toggles a Shortcuts list with the full map and the left-Alt / number-row notes', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const help = $('[data-studio-shortcuts-help]')
  assert.equal(help.querySelector('[data-studio-key]')?.textContent, K().help)
  assert.ok($('[data-studio-shortcuts-list]') === null)
  const event = await press(K().help)
  assert.equal(event.defaultPrevented, true)
  const list = $('[data-studio-shortcuts-list]')
  assert.ok(list, 'F1 opened the list')
  // The list is the map: one row per entry, in map order, with the combo the map holds (the model row joins its three).
  const rowCombo = value => (typeof value === 'string' ? value : Object.values(value).join(' / '))
  const rows = [...list.querySelectorAll('[data-studio-shortcut-row]')].map(row => row.getAttribute('data-studio-shortcut-row'))
  assert.deepEqual(rows, Object.values(K()).map(rowCombo), 'F1 list = shortcut map')
  for (const combo of rows) assert.ok(list.querySelector(`[data-studio-shortcut-row=\"${combo}\"]`), `${combo} listed`)
  assert.match(list.textContent, /left Alt/)
  assert.match(list.textContent, /physical number row/)
  assert.equal(help.getAttribute('aria-expanded'), 'true')
  await click('[data-studio-shortcuts-help]')
  assert.ok($('[data-studio-shortcuts-list]') === null, 'click closes it')
  await press(K().close)
  assert.equal((await press(K().help)).defaultPrevented, false, 'F1 is the app\'s while the studio is closed')
})

test('U4/U5/U13: key caps are the SDK Kbd; the primary cap is inverted with no opacity; reserved caps hold the width', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const primaryCap = $('[data-studio-skip] [data-studio-key]')
  assert.equal(primaryCap.tagName, 'KBD', 'SDK Kbd')
  assert.equal(primaryCap.getAttribute('data-kbd-variant'), 'inverted', 'own background from currentColor')
  assert.doesNotMatch(primaryCap.getAttribute('style') || '', /opacity/)
  await press(K().skip)
  const confirm = $('[data-studio-confirm]')
  assert.equal(confirm.disabled, true)
  const reserved = confirm.querySelector('[data-studio-key-reserved]')
  assert.ok(reserved, 'disabled Confirm keeps an invisible F5 cap')
  assert.match(reserved.getAttribute('style'), /visibility: hidden/)
  assert.ok(confirm.querySelector('[data-studio-key]') === null, 'no visible key on a disabled button')
})

test('U6: keys during IME composition are ignored', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const field0 = field()
  const composing = await press(K().skip, document.body, { isComposing: true })
  assert.equal(field(), field0)
  assert.equal(composing.defaultPrevented, false)
  await press(K().skip, document.body, { keyCode: 229 })
  assert.equal(field(), field0, 'keyCode 229 ignored too')
})

test('U17: while open, F5-F10 are swallowed even with no control for them; Esc/Tab/Enter are never taken (U2 declined)', { skip }, async () => {
  await openStudio(INTENT, 'off')
  assert.equal(field(), 'thirdPartyText')
  assert.ok($('[data-studio-shortcut="F5"]') === null, 'no F5 control on the paste step')
  assert.equal((await press(K().accept)).defaultPrevented, true)
  for (const key of ['Escape', 'Tab', 'Enter']) assert.equal((await press(key)).defaultPrevented, false, key)
  assert.equal(field(), 'thirdPartyText', 'nothing ran')
})

test('U9: failures read as plain words; the technical detail is only in the tooltip', { skip }, async () => {
  backend.suggest = () => { throw new TypeError("Cannot read properties of undefined (reading 'kind')") }
  backend.compose = () => { throw new TypeError("Cannot read properties of undefined (reading 'kind')") }
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  const error = $('[data-studio-ai-error]')
  assert.doesNotMatch(error.textContent, /Cannot read|TypeError/)
  assert.match(error.getAttribute('title'), /Cannot read/)
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview-note]'))
  const note = $('[data-studio-preview-note]')
  assert.doesNotMatch(note.textContent, /Cannot read|TypeError/)
  assert.match(note.textContent, /version without AI/)
  assert.match(note.getAttribute('title'), /Cannot read/)
  await click('[data-studio-cancel]')
  backend.suggest = () => { throw new Error('HTTP 405 Method Not Allowed') }
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.match($('[data-studio-ai-error]').textContent, /Restart Hermes Desktop/)
})

test('U10/U11/U12/U15: labelled region, small live status, labelled answer field, radiogroups, labelled "Another"', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await waitFor(aiReady)
  const strip = $('[data-studio-strip]')
  assert.equal(strip.getAttribute('role'), 'region')
  assert.equal(strip.getAttribute('aria-label'), 'Prompt Studio')
  assert.equal($('[data-studio-ai-row]').hasAttribute('aria-live'), false, 'the whole AI row is not live')
  assert.equal($('[data-studio-ai-status]').getAttribute('aria-live'), 'polite')
  assert.match($('[data-studio-ai-status]').textContent, /ready/)
  assert.match($('[data-studio-announce]').textContent, /^Step \d+: /)
  const input = $('[data-studio-answer-input]')
  assert.equal(document.getElementById(input.getAttribute('aria-labelledby'))?.textContent, currentText())
  assert.equal(input.hasAttribute('aria-label'), false)
  const target = $('[data-studio-target]')
  assert.equal(target.getAttribute('role'), 'radiogroup')
  assert.equal($('[data-studio-target-option="opus"]').getAttribute('role'), 'radio')
  assert.equal($('[data-studio-target-option="opus"]').getAttribute('aria-checked'), 'true')
  assert.equal($('[data-studio-ai-toggle]').getAttribute('aria-keyshortcuts'), K().mode, 'Alt+I belongs to the group')
  for (const b of document.querySelectorAll('[data-studio-ai-mode-option]')) assert.equal(b.hasAttribute('aria-keyshortcuts'), false)
  const another = $('[data-studio-ai-retry]')
  assert.equal(another.getAttribute('aria-label'), 'Ask for another suggestion')
  assert.match(another.textContent, /Another/)
})

test('U14: the done state names the real Generate label and its key', { skip }, async () => {
  await openStudio(INTENT, 'off')
  for (let i = 0; i < 20 && $('[data-studio-step]'); i += 1) await press($('[data-studio-skip]') ? K().skip : K().accept)
  assert.equal(currentText(), `All steps answered. Choose “Generate prompt” (${K().generate}).`)
  assert.doesNotMatch(currentText(), /Click/)
})

test('visual rules: no pill buttons, no italic, no monospace labels, no cream backgrounds', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await waitFor(aiReady)
  await press(K().help)
  for (const el of document.querySelectorAll('[data-studio-strip] *')) {
    const style = el.getAttribute('style') || ''
    assert.doesNotMatch(style, /font-style: italic/)
    assert.doesNotMatch(style, /border-radius: (9\d{2,}|[1-9]\d{2,})px|border-radius: 50%/, 'no pill')
    assert.doesNotMatch(style, /background: (#f[5-9a-f][e-f0-9]{4}|rgb\(2[45]\d, 2[45]\d, 2[0-4]\d\)|ivory|beige|cornsilk)/i, 'no cream')
    if (el.tagName !== 'PRE') assert.doesNotMatch(style, /font-mono|monospace/, 'no monospace label')
  }
  assert.doesNotMatch(document.getElementById('top').textContent, /\b0[1-9]\b/)
})

// Hermes Desktop plugin SDK, Pitfalls: "Never hardcode colors (`#000`, `black`, `rgb(...)`)", and
// only variables the host really defines, so a theme switch recolors everything.
test('colors: only host theme variables, no hardcoded color even as a var() fallback', () => {
  const { readFileSync } = createRequire(import.meta.url)('node:fs')
  const source = readFileSync(process.env.PROMPT_STUDIO_PLUGIN || join(repo, 'desktop', 'plugin.js'), 'utf8')
  const ui = source.slice(source.indexOf('// @core-end'))
  assert.deepEqual(ui.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) || [], [], 'no hex or rgb() colors')
  for (const name of ['--ui-accent-foreground', '--ui-text-danger', '--ui-text-warning']) assert.ok(!ui.includes(name), `${name} is not a host variable`)
  // The primary button uses the host's own primary pair (the SDK Button's bg-primary / text-primary-foreground).
  assert.ok(ui.includes("background: primary ? 'var(--dt-primary)'") && ui.includes("color: primary ? 'var(--dt-primary-foreground)'"))
})


// ---------------------------------------------------------------- single recommendation (Auto mode)
const recommends = () => document.querySelectorAll('[data-studio-recommend]')
const stars = () => [...document.querySelectorAll('[data-studio-strip] button')].filter(b => b.textContent.includes('★'))
const primaries = () => [...document.querySelectorAll('[data-studio-strip] button')].filter(b => /font-weight: 600/.test(b.getAttribute('style') || ''))
// Pending /suggest: each call waits until the test resolves or rejects it.
function holdSuggest() {
  const pending = []
  backend.suggest = body => new Promise((resolve, reject) => { pending.push({ body, resolve, reject }) })
  return pending
}
// Walk (AI off) to the first choice step, then switch the mode so the AI starts on that step.
async function toEnumStep(mode) {
  await openStudio(INTENT, 'off')
  await pasteStep('')
  for (let i = 0; i < 12 && !$('[data-studio-options]'); i += 1) await answerStep()
  assert.ok($('[data-studio-options]'), 'reached a choice step')
  const local = $('[data-studio-recommend]').textContent.replace(/^★ Recommended: /, '').replace(/F5$/, '')
  await setMode(mode)
  if (mode === 'auto') await waitFor(() => suggestFields().length > 0)
  else await settle() // intentional: the On-request test proves no automatic call is made
  return local
}
const optionLabels = () => [...document.querySelectorAll('[data-studio-option]')].map(el => el.getAttribute('data-studio-option'))

test('Auto, choice step: while the AI loads no option card is shown (they depend on it)', { skip }, async () => {
  const pending = holdSuggest()
  await toEnumStep('auto')
  assert.ok(pending.length >= 1, 'AI asked automatically')
  assert.ok($('[data-studio-ai-loading]'), 'AI row loading')
  assert.equal(recommends().length, 0, 'no recommended button while loading')
  assert.equal(stars().length, 0, 'no star while loading')
  assert.equal(optionLabels().length, 0, 'no option cards while loading')
  assertEverythingHasAKey()
  const local = pending.at(-1).body.field.recommended
  pending.at(-1).resolve({ ok: true, value: local, reason: 'x' })
  await waitFor(notLoading)
})

test('Auto, choice step: the AI pick is the single recommended button (F5); no F7; AI agreeing gives one button too', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('auto')
  const other = pending.at(-1).body.field.options.find(o => o !== local)
  pending.at(-1).resolve({ ok: true, value: other, reason: 'porque sim' })
  await waitFor(notLoading)
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1, 'exactly one star')
  assert.equal(primaries().length, 1, 'exactly one primary')
  assert.match(recommends()[0].textContent, new RegExp(`★ Recommended by AI: ${other}`))
  assert.equal(recommends()[0].querySelector('[data-studio-key]').textContent, K().accept)
  assert.ok($('[data-studio-ai-use]') === null, 'no separate Use suggestion (F7) on a choice step')
  assert.ok(optionLabels().includes(local) && !optionLabels().includes(other), 'local pick neutral, AI pick not duplicated')
  assert.match($('[data-studio-ai-row]').textContent, /Why: porque sim/)
  assert.ok($('[data-studio-ai-discard]') && $('[data-studio-ai-retry]'))
  assertEverythingHasAKey()
  // Another -> the AI agrees with the local pick: still one button.
  await click('[data-studio-ai-retry]')
  assert.equal(recommends().length, 0, 'neutral again while reloading')
  pending.at(-1).resolve({ ok: true, value: local, agrees: true, reason: 'ok' })
  await waitFor(notLoading)
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`Recommended by AI: ${local}`))
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press(K().accept)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, n + 1)
  assert.match([...document.querySelectorAll('[data-studio-rung]')].at(-1).textContent, new RegExp(local))
})

test('Auto, choice step: AI failure or Discard brings back the local recommendation as the single F5', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('auto')
  pending.at(-1).reject(new Error('HTTP 502 upstream'))
  await waitFor(notLoading)
  assert.equal(recommends().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`^★ Recommended: ${local}`))
  assert.equal(stars().length, 1)
  // Retry, then stop while loading: local recommendation again.
  await click('[data-studio-ai-retry-error]')
  assert.equal(recommends().length, 0)
  await click('[data-studio-ai-stop]')
  assert.equal(recommends().length, 1)
  assert.match(recommends()[0].textContent, /^★ Recommended: /)
  assertEverythingHasAKey()
})

test('On request: local recommendation only; once asked and ready, the AI pick replaces it (never two stars)', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('manual')
  // (the Auto /suggest of the deliverable step, asked while the mode was still Auto, is not an automatic call here)
  assert.equal(pending.filter(p => p.body.field.id !== 'deliverable').length, 0, 'no automatic call')
  assert.equal(recommends().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`^★ Recommended: ${local}`))
  await click('[data-studio-ai-suggest]')
  const other = optionLabels().find(o => o !== local)
  pending.at(-1).resolve({ ok: true, value: other, reason: 'r' })
  await waitFor(notLoading)
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`Recommended by AI: ${other}`))
  assert.ok($('[data-studio-ai-use]') === null)
  await setMode('off')
  assert.equal(recommends().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`^★ Recommended: ${local}`))
})

test('Auto, design text step: the AI text is the single primary (F5 uses it); the default list becomes a neutral option', { skip }, async () => {
  backend.suggest = body => ({ ok: true, value: body.field.kind === 'enum' ? body.field.recommended : `IA: evitar ${body.field.id}`, reason: 'r' })
  await openStudio(INTENT, 'off')
  await pasteStep('')
  for (let i = 0; i < 12 && field() !== 'designAvoid'; i += 1) await answerStep()
  assert.equal(field(), 'designAvoid')
  await setMode('auto')
  await waitFor(aiReady)
  assert.equal(recommends().length, 1)
  assert.equal(primaries().length, 1, 'one primary')
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, /Use AI suggestion/)
  assert.equal(recommends()[0].querySelector('[data-studio-key]').textContent, K().accept)
  assert.match($('[data-studio-use-default]').textContent, /Use: recommended list/)
  assertEverythingHasAKey()
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press(K().accept)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, n + 1)
  assert.match([...document.querySelectorAll('[data-studio-rung]')].at(-1).textContent, /IA: evitar designAvoid/)
})

test('Auto walk: never more than one recommended button or star on screen at any time', { skip }, async () => {
  backend.suggest = body => ({ ok: true, value: body.field.kind === 'enum' ? body.field.options.at(-1) : '', reason: 'r' })
  await openStudio(INTENT, 'auto')
  await pasteStep('')
  for (let i = 0; i < 14 && field(); i += 1) {
    await waitFor(aiReady)
    assert.ok(recommends().length <= 1, `at most one recommend on "${currentText()}"`)
    assert.ok(stars().length <= 1, `at most one star on "${currentText()}"`)
    assert.ok(primaries().length <= 1, `at most one primary on "${currentText()}"`)
    assertEverythingHasAKey()
    await answerStep()
  }
})

// ---------------------------------------------------------------- fix round 3
test('CT-01: an error code from the backend shows a localized tooltip; unknown or missing code keeps the raw detail', { skip }, async () => {
  backend.suggest = () => ({ ok: false, code: 'timeout', error: 'no model reply within 20 s' })
  backend.compose = () => ({ ok: false, code: 'invalid_prompt', error: 'model reply is not a valid prompt' })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  const error = $('[data-studio-ai-error]')
  assert.match(error.textContent, /Could not reach the AI/, 'top-level text unchanged')
  assert.equal(error.getAttribute('title'), ui.translate('errors.timeout'))
  assert.match(error.getAttribute('title'), /did not answer in time/)
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview-note]'))
  const note = $('[data-studio-preview-note]')
  assert.match(note.textContent, /did not write a prompt/, 'preview.empty note unchanged')
  assert.equal(note.getAttribute('title'), ui.translate('errors.invalid_prompt'))
  await click('[data-studio-cancel]')
  // pt tooltip for the same code.
  ui.i18n.locale = 'pt'
  await ui.act(async () => { ui.$locale.set('pt') })
  backend.suggest = () => ({ ok: false, empty: true, code: 'empty_reply', error: 'empty model reply' })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.equal($('[data-studio-ai-error]').getAttribute('title'), ui.i18n.bundles.pt.errors.empty_reply)
  await click('[data-studio-cancel]')
  ui.i18n.locale = 'en'
  await ui.act(async () => { ui.$locale.set('en') })
  // Older backend / unknown code: the raw detail, as before.
  backend.suggest = () => ({ ok: false, code: 'brand_new_code', error: 'raw detail 1' })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.equal($('[data-studio-ai-error]').getAttribute('title'), 'raw detail 1')
})

test('#25: a too_long reply shows its own localized message, not the generic "could not reach the AI"', { skip }, async () => {
  backend.suggest = () => ({ ok: false, code: 'too_long', error: 'answer is longer than 1200 characters', limit: 1200 })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  const error = $('[data-studio-ai-error]')
  assert.equal(error.textContent, ui.i18n.bundles.en.ai.tooLong)
  assert.equal(error.getAttribute('title'), ui.i18n.bundles.en.errors.too_long)
  assert.ok(!/Could not reach/.test(error.textContent))
  await click('[data-studio-cancel]')
  ui.i18n.locale = 'pt'
  await ui.act(async () => { ui.$locale.set('pt') })
  await openStudio()
  await pasteStep('')
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.equal($('[data-studio-ai-error]').textContent, ui.i18n.bundles.pt.ai.tooLong)
  assert.equal($('[data-studio-ai-error]').getAttribute('title'), ui.i18n.bundles.pt.errors.too_long)
  await click('[data-studio-cancel]')
  ui.i18n.locale = 'en'
  await ui.act(async () => { ui.$locale.set('en') })
})

test('SP-2: in Auto, clicking through steps fast sends one /suggest, for the step the user stops on, after the delay', { skip }, async () => {
  globalThis.__promptStudioAutoSuggestDelayMs = 400
  try {
    await openStudio()
    await pasteStep('')
    await click('[data-studio-skip]')
    await click('[data-studio-skip]')
    await click('[data-studio-skip]')
    assert.equal(suggestFields().length, 0, 'nothing sent while the user is still moving')
    const stoppedOn = field()
    // Real elapsed time is the point here (the 400 ms debounce), so this sleep stays.
    await new Promise(resolve => setTimeout(resolve, 450))
    await waitFor(() => $('[data-studio-ai-use]'))
    assert.deepEqual(suggestFields(), [stoppedOn], 'one request, for the step the user stayed on')
    assert.ok($('[data-studio-ai-use]'), 'the suggestion is shown after the delay')
    // Manual asks stay immediate.
    await setMode('manual')
    await answerStep()
    const before = suggestFields().length
    await click('[data-studio-ai-suggest]')
    assert.equal(suggestFields().length, before + 1, 'manual request sent at once')
  } finally {
    globalThis.__promptStudioAutoSuggestDelayMs = 0
  }
})

test('SDK: timers go through ctx.setTimeout; the debounce fires once, is cancelled on leave, and request deadlines are cleared or reject', { skip }, async () => {
  globalThis.__promptStudioAutoSuggestDelayMs = 60
  try {
    await openStudio()
    await pasteStep('')
    const debounce = () => ui.timers.filter(t => t.ms === 60)
    // Leaving the step before the delay cancels the pending ask (cancelAutoSuggestion).
    const first = debounce().at(-1)
    assert.ok(first, 'debounce scheduled through ctx.setTimeout')
    await click('[data-studio-skip]')
    assert.equal(first.cleared, true, 'moving on cancels the pending debounce')
    assert.equal(first.fired, false)
    const stoppedOn = field()
    const before = suggestFields().length
    await waitFor(() => $('[data-studio-ai-use]'))
    assert.equal(debounce().at(-1).fired, true, 'the debounce fired')
    assert.equal(suggestFields().length, before + 1, 'exactly one request')
    assert.deepEqual(suggestFields().slice(-1), [stoppedOn])
    // The /suggest deadline was armed through ctx and cleared once the request settled.
    const deadline = ui.timers.filter(t => t.ms === 25_000).at(-1)
    assert.ok(deadline, 'request deadline armed through ctx.setTimeout')
    assert.equal(deadline.cleared, true, 'deadline cleared when the request settled')
    assert.equal(deadline.fired, false)
  } finally {
    globalThis.__promptStudioAutoSuggestDelayMs = 0
  }
  // A hung request still rejects after the deadline, through a ctx timer.
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await click('[data-studio-cancel]')
  backend.context = () => new Promise(() => {})
  globalThis.__promptStudioContextTimeoutMs = 25
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await click('[data-studio-open]')
    await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(ui.i18n.bundles.en.errors.timeout))
    const hung = ui.timers.filter(t => t.ms === 25).at(-1)
    assert.ok(hung && hung.fired === true, 'the deadline fired through ctx.setTimeout')
  } finally {
    delete globalThis.__promptStudioContextTimeoutMs
  }
  const source = await import('node:fs').then(fs => fs.readFileSync(join(repo, 'desktop', 'plugin.js'), 'utf8'))
  const uiPart = source.slice(source.indexOf('// @studio-end'))
  assert.equal((uiPart.match(/(?<![.\w])setTimeout\(/g) || []).length, 1, 'only the fallback for hosts without ctx.setTimeout')
  assert.doesNotMatch(uiPart, /(?<![.\w])setInterval\(/)
})

test('SDK: a timer still pending when the host disposes the plugin never fires', { skip }, async () => {
  globalThis.__promptStudioAutoSuggestDelayMs = 60
  try {
    await openStudio()
    await pasteStep('')
    const pending = ui.timers.filter(t => t.ms === 60).at(-1)
    assert.ok(pending && pending.fired === false, 'debounce pending')
    assert.ok(ui.disposers.includes(pending.clear), 'its cleanup is registered with the host')
    const before = suggestFields().length
    pending.clear() // what the host runs for this timer on dispose
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(pending.fired === false, 'the disposed timer did not fire')
    assert.equal(suggestFields().length, before, 'no request after dispose')
  } finally {
    globalThis.__promptStudioAutoSuggestDelayMs = 0
    await click('[data-studio-cancel]')
  }
})

test('RG-1: switching the AI off while a suggestion is in flight drops the late answer', { skip }, async () => {
  let release
  backend.suggest = () => new Promise(resolve => { release = () => resolve({ ok: true, value: 'TARDE', reason: 'x' }) })
  await openStudio(INTENT, 'manual')
  await pasteStep('')
  await click('[data-studio-ai-suggest]')
  assert.ok($('[data-studio-ai-loading]'))
  await setMode('off')
  release()
  await settle() // intentional: proves the late suggestion is dropped
  assert.equal(aiMode(), 'off')
  assert.ok($('[data-studio-ai-row]') === null, 'no suggestion row')
  assert.ok($('[data-studio-ai-use]') === null)
  assert.equal($('[data-studio-answer-input]').value, '', 'answer unchanged')
})

test('RG-1: switching the AI off while /compose is in flight drops the late AI prompt', { skip }, async () => {
  let release
  backend.compose = () => new Promise(resolve => { release = () => resolve({ ok: true, prompt: 'PROMPT TARDIO DA IA', notes: 'ok' }) })
  await openStudio()
  await click('[data-studio-generate]')
  assert.ok($('[data-studio-ai-mode-option="off"]'), 'mode selector reachable while the prompt is written')
  await setMode('off')
  release()
  await waitFor(() => $('[data-studio-preview]'))
  await settle() // intentional: proves the late AI prompt is not applied
  assert.ok($('[data-studio-preview]'), 'preview shown')
  assert.doesNotMatch($('[data-studio-preview-text]').textContent, /PROMPT TARDIO/, 'late AI prompt not applied')
  assert.ok($('[data-studio-switch-version]') === null)
})


// ---------------------------------------------------------------- CX-1: settings + session context
const SETTING_KEYS = ['helperModel', 'contextModel', 'readContext', 'language']
const contextCalls = () => backend.calls.filter(c => c.path === '/context')
const suggestCalls = () => backend.calls.filter(c => c.path === '/suggest')
async function freshSettings(sessionId = null) {
  if ($('[data-studio-cancel]')) await click('[data-studio-cancel]')
  for (const key of SETTING_KEYS) ui.storage.remove(key)
  ui.host.state.focusedStoredSessionId.set(sessionId)
  ui.host.state.focusedSessionProfile.set('work')
  backend.calls.length = 0
}
async function openSettings() {
  if (!$('[data-studio-settings-dialog]')) await click('[data-studio-settings]')
  assert.ok($('[data-studio-settings-dialog]'), 'settings dialog open')
}
async function pickModel(which, model, provider, effort) {
  await openSettings()
  const menu = $(`[data-studio-model-picker="${which}"] [data-model-menu]`)
  assert.ok(menu, `${which} catalog menu`)
  const key = `${which}Model`
  await ui.act(async () => { menu.__controller.select(model, provider) })
  await waitFor(() => ui.storage.get(key)?.model === model)
  if (effort !== undefined) {
    const next = $(`[data-studio-model-picker="${which}"] [data-model-menu]`).__controller
    await ui.act(async () => { next.setOptions({ effort }, { model, provider }) })
    await waitFor(() => ui.storage.get(key)?.effort === effort)
  }
}
async function closeSettings() {
  if ($('[data-studio-settings-close]')) await click('[data-studio-settings-close]')
}
// Open in auto mode, then reopen so the counted calls belong to one clean opening.
async function openFresh(intent = INTENT, mode = 'auto') {
  if ($('[data-studio-cancel]')) await click('[data-studio-cancel]')
  await openStudio(intent, mode)
  await click('[data-studio-cancel]')
  backend.calls.length = 0
  $('[data-slot="composer-rich-input"]').textContent = intent
  await click('[data-studio-open]')
}

test('CX-1: the gear button shows F3, F3 and a click open the settings dialog, F1 lists F3', { skip }, async () => {
  await freshSettings()
  await openStudio(INTENT, 'off')
  const gear = $('[data-studio-settings]')
  assert.ok(gear, 'gear button in the studio header')
  assert.ok(gear.querySelector('[data-codicon="settings-gear"]'), 'gear icon')
  assert.equal(gear.querySelector('[data-studio-key]')?.textContent, K().settings, 'F3 printed on it')
  assertEverythingHasAKey()
  await press(K().settings)
  assert.ok($('[data-studio-settings-dialog]'), 'F3 opened the dialog')
  await closeSettings()
  assert.ok($('[data-studio-settings-dialog]') === null)
  await click('[data-studio-settings]')
  assert.ok($('[data-studio-settings-dialog]'), 'click opened it')
  await closeSettings()
  await press(K().help)
  assert.ok($(`[data-studio-shortcuts-list] [data-studio-shortcut-row="${K().settings}"]`), 'settings key in the F1 list')
  await press(K().help)
})

test('CX-1: helper/context pickers persist and ride as model_choice; clearing falls back', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await pickModel('helper', 'claude-haiku-5', 'anthropic', 'low')
  assert.deepEqual(ui.storage.get('helperModel'), { provider: 'anthropic', model: 'claude-haiku-5', effort: 'low' })
  await pickModel('context', 'gpt-6-mini', 'openai')
  assert.deepEqual(ui.storage.get('contextModel'), { provider: 'openai', model: 'gpt-6-mini', effort: '' })
  await closeSettings()
  await openFresh()
  assert.deepEqual(contextCalls().map(c => c.body.model_choice), [{ provider: 'openai', model: 'gpt-6-mini', effort: '' }])
  await pasteStep('')
  await waitFor(() => suggestCalls().length >= 1)
  assert.ok(suggestCalls().length >= 1, 'auto suggestion asked')
  assert.deepEqual(suggestCalls()[0].body.model_choice, { provider: 'anthropic', model: 'claude-haiku-5', effort: 'low' })
  await click('[data-studio-generate]')
  await waitFor(() => backend.calls.find(c => c.path === '/compose'))
  const compose = backend.calls.find(c => c.path === '/compose')
  assert.deepEqual(compose.body.model_choice, { provider: 'anthropic', model: 'claude-haiku-5', effort: 'low' })
  assert.equal('session_context' in compose.body, false, 'no session_context on /compose')
  await click('[data-studio-cancel]')
  // Clear the context model: /context uses the helper's choice.
  await openStudio(INTENT, 'auto')
  await openSettings()
  await click('[data-studio-model-picker="context"] [data-studio-model-clear]')
  assert.match($('[data-studio-model-picker="context"]').textContent, /Same as the questions/)
  await closeSettings()
  await openFresh()
  assert.deepEqual(contextCalls().at(-1).body.model_choice, { provider: 'anthropic', model: 'claude-haiku-5', effort: 'low' })
  // Clear the helper model: no model_choice at all (Hermes config).
  await openSettings()
  await click('[data-studio-model-picker="helper"] [data-studio-model-clear]')
  assert.match($('[data-studio-model-picker="helper"]').textContent, /Hermes default/)
  await closeSettings()
  await openFresh()
  assert.equal('model_choice' in contextCalls().at(-1).body, false)
  await pasteStep('')
  await waitFor(() => suggestCalls().length >= 1)
  assert.equal('model_choice' in suggestCalls().at(-1).body, false)
})

test('CX-1: F4 on a stored session with AI on reads the context once; fresh draft, AI off or switch off read nothing', { skip }, async () => {
  await freshSettings('sess-1')
  await openFresh()
  await waitFor(() => /claude-haiku-5/.test($('[data-studio-context-status]')?.textContent))
  assert.equal(contextCalls().length, 1, 'exactly one /context')
  assert.deepEqual(contextCalls()[0].body, { session_id: 'sess-1', profile: 'work', locale: 'en' })
  assert.match($('[data-studio-context-status]').textContent, /claude-haiku-5/)
  await pasteStep('')
  await waitFor(aiReady)
  await settle() // intentional: proves no second /context
  assert.equal(contextCalls().length, 1, 'still one after moving on')
  // Default: the switch is on.
  await openSettings()
  assert.equal($('[data-studio-read-context] [role="switch"]').getAttribute('aria-checked'), 'true')
  await closeSettings()
  // Fresh draft: nothing read.
  await freshSettings(null)
  await openFresh()
  assert.equal(contextCalls().length, 0, 'fresh draft')
  assert.ok($('[data-studio-context-status]') === null)
  // AI off: nothing read.
  await freshSettings('sess-1')
  await openFresh(INTENT, 'off')
  assert.equal(contextCalls().length, 0, 'AI off')
  // Switch off: nothing read, and it is remembered.
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await openSettings()
  await click('[data-studio-read-context] [role="switch"]')
  assert.equal(ui.storage.get('readContext'), false)
  await closeSettings()
  await openFresh()
  assert.equal(contextCalls().length, 0, 'readContext off')
  // Nothing configured: pickers read the Hermes default, and the context one says it follows the questions.
  await freshSettings(null)
  await openStudio(INTENT, 'auto')
  await openSettings()
  assert.match($('[data-studio-model-picker="helper"]').textContent, /Hermes default/)
  assert.match($('[data-studio-model-picker="context"]').textContent, /Same as the questions \(Hermes default\)/)
  await closeSettings()
})

test('CX-1: a model catalog that fails to load leaves the Studio working and the pickers on the default', { skip }, async () => {
  await freshSettings(null)
  await openStudio(INTENT, 'off')
  globalThis.__promptStudioBreakCatalog = true
  const quiet = console.error
  console.error = () => {}
  try {
    await openSettings()
    assert.match($('[data-studio-model-picker="helper"]').textContent, /Hermes default/)
    await closeSettings()
    assert.ok($('[data-studio-strip]'), 'studio still on screen')
  } finally {
    delete globalThis.__promptStudioBreakCatalog
    console.error = quiet
  }
})

test('CX-1: an Auto suggestion waits for a pending context read and then carries session_context', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await click('[data-studio-cancel]')
  let release
  backend.context = () => new Promise(resolve => { release = () => resolve({ ok: true, summary: 'RESUMO LENTO', model: 'openai/gpt-6-mini', turns: 3, ms: 900 }) })
  backend.calls.length = 0
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  await click('[data-studio-open]')
  assert.match($('[data-studio-context-loading]').textContent, /Reading/)
  await settle() // intentional: proves no /suggest before the context read ends
  assert.equal(suggestCalls().length, 0, 'waits for the context read')
  release()
  await waitFor(() => field() === 'deliverable')
  await pasteStep('')
  await waitFor(() => suggestCalls().length >= 1)
  assert.equal(suggestCalls().length, 1)
  assert.equal(suggestCalls()[0].body.session_context, 'RESUMO LENTO')
})

test('CX-1: a failed or timed-out context read shows a short note and the suggestion goes on without it', { skip }, async () => {
  await freshSettings('sess-1')
  backend.context = () => ({ ok: false, code: 'no_session', error: 'Session not found' })
  await openFresh()
  await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(ui.i18n.bundles.en.errors.no_session))
  assert.equal($('[data-studio-context-status]').textContent.includes(ui.i18n.bundles.en.errors.no_session), true)
  await pasteStep('')
  await waitFor(() => suggestCalls().length >= 1)
  assert.equal(suggestCalls().length, 1)
  assert.equal('session_context' in suggestCalls()[0].body, false)
  // Client-side deadline: a hung transport counts as a timeout.
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await click('[data-studio-cancel]')
  backend.context = () => new Promise(() => {})
  globalThis.__promptStudioContextTimeoutMs = 20
  try {
    backend.calls.length = 0
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await click('[data-studio-open]')
    // The 20 ms client deadline elapses in real time; wait for its outcome instead of a fixed sleep.
    await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(ui.i18n.bundles.en.errors.timeout))
    await pasteStep('')
    await waitFor(() => suggestCalls().length >= 1)
    assert.equal($('[data-studio-context-status]').textContent.includes(ui.i18n.bundles.en.errors.timeout), true)
    assert.equal(suggestCalls().length, 1, 'suggestion went on')
    assert.equal('session_context' in suggestCalls()[0].body, false)
  } finally {
    delete globalThis.__promptStudioContextTimeoutMs
  }
  // A chosen model the provider does not know says so.
  await freshSettings('sess-1')
  backend.context = () => ({ ok: false, code: 'model_not_found', error: 'model not found: NotFoundError' })
  await openFresh()
  await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(errorText('model_not_found')))
  assert.equal($('[data-studio-context-status]').textContent.includes(errorText('model_not_found')), true)
  // A model the provider refuses (401/403, MODEL_NOT_IN_PLAN) says so too.
  await freshSettings('sess-1')
  backend.context = () => ({ ok: false, code: 'provider_refused', error: 'provider refused: PermissionDeniedError' })
  await openFresh()
  await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(errorText('provider_refused')))
  assert.equal($('[data-studio-context-status]').textContent.includes(errorText('provider_refused')), true)
  // Billing (402) and bad request (400) get their own notes too.
  for (const code of ['provider_payment', 'provider_bad_request']) {
    await freshSettings('sess-1')
    backend.context = () => ({ ok: false, code, error: `${code}: APIStatusError` })
    await openFresh()
    await waitFor(() => $('[data-studio-context-status]')?.textContent.includes(errorText(code)))
    assert.ok($('[data-studio-context-status]').textContent.includes(errorText(code)))
  }
  for (const code of ['no_session', 'empty_session', 'invalid_summary', 'model_not_found', 'provider_refused', 'provider_payment', 'provider_bad_request']) {
    assert.ok(errorText(code) && errorText(code, 'pt'), `errors.${code} in en and pt`)
  }
})

test('CX-1: language "pt" with Hermes in English shows Portuguese strings and questions and sends locale pt; "auto" follows Hermes', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await openSettings()
  assert.equal($('[data-studio-language] [data-sdk-select]').getAttribute('data-sdk-select'), 'auto', 'default follows Hermes')
  await click('[data-studio-language] [data-sdk-select-item="pt"]')
  assert.equal(ui.storage.get('language'), 'pt')
  await closeSettings()
  assert.match($('[data-studio-cancel]').textContent, /^Cancelar/)
  await openFresh()
  assert.equal(contextCalls()[0].body.locale, 'pt')
  assert.match(currentText(), /receber no final/i, 'question in Portuguese')
  // The suggestion's reason and the polish notes are written in {language}: /suggest and /compose carry the locale too.
  await pasteStep('')
  await waitFor(() => suggestCalls().length >= 1)
  assert.ok(suggestCalls().length >= 1, 'auto suggestion asked')
  assert.equal(suggestCalls().at(-1).body.locale, 'pt', 'suggest locale follows the Studio language')
  await click('[data-studio-generate]')
  await waitFor(() => backend.calls.some(c => c.path === '/compose'))
  assert.equal(backend.calls.filter(c => c.path === '/compose').at(-1)?.body.locale, 'pt', 'compose locale follows the Studio language')
  await openFresh()
  // Back to auto: English again (Hermes is in English).
  await openSettings()
  await click('[data-studio-language] [data-sdk-select-item="auto"]')
  await closeSettings()
  assert.match($('[data-studio-cancel]').textContent, /^Cancel(?!ar)/)
  await openFresh()
  assert.equal(contextCalls()[0].body.locale, 'en')
  // 'auto' keeps following Hermes when Hermes switches to pt.
  ui.i18n.locale = 'pt'
  await ui.act(async () => { ui.$locale.set('pt') })
  await waitFor(() => /^Cancelar/.test($('[data-studio-cancel]').textContent))
  assert.match($('[data-studio-cancel]').textContent, /^Cancelar/)
  ui.i18n.locale = 'en'
  await ui.act(async () => { ui.$locale.set('en') })
  await freshSettings(null)
})


// ---------------------------------------------------------------- final step: send now (F9) or edit first (Alt+E)
const composer = () => ui.host.composer
function resetComposer() { composer().submits.length = 0; composer().focuses.length = 0; composer().writes.length = 0; composer().inserts.length = 0; composer().offscreen.clear(); composer().submitResult = true }
async function toPreview() {
  resetComposer()
  await freshSettings(null)
  await openStudio()
  await click('[data-studio-generate]')
  await waitFor(() => $('[data-studio-preview]'))
}

test('FIN-1: the preview offers Send now (F9) and Put in composer to edit (Alt+E); both keys shown and listed', { skip }, async () => {
  await toPreview()
  const send = $('[data-studio-send-prompt]')
  const edit = $('[data-studio-use-prompt]')
  assert.ok(send && edit, 'both final actions')
  assert.equal(send.querySelector('[data-studio-key]').textContent, K().generate)
  assert.equal(edit.querySelector('[data-studio-key]').textContent, K().editPrompt)
  assert.match(send.textContent, /^Send now/)
  assert.match(edit.textContent, /^Put in composer to edit/)
  assert.ok($('[data-studio-back-to-steps]') && $('[data-studio-cancel]'), 'other preview buttons kept')
  assert.ok(document.activeElement === send, 'focus on Send now')
  assertEverythingHasAKey()
  await press(K().help)
  assert.ok($('[data-studio-shortcuts-list] [data-studio-shortcut-row="Alt+E"]'), 'Alt+E in the F1 list')
  await press(K().help)
  for (const locale of ['en', 'pt']) {
    const b = ui.i18n.bundles[locale]
    assert.ok(b.preview.send && b.preview.edit && b.shortcuts.editPrompt, `labels in ${locale}`)
  }
  assert.equal(ui.i18n.bundles.pt.preview.send, 'Enviar agora')
})

test('FIN-1: F9 on the preview sends the prompt through host.composer.submit for the bound session and closes', { skip }, async () => {
  await toPreview()
  const prompt = $('[data-studio-preview-text]').textContent
  await press(K().generate)
  assert.deepEqual(composer().submits, [{ sessionId: 'sess-live', text: prompt }])
  assert.ok($('[data-studio-strip]') === null, 'studio closed')
  assert.equal(draft(), '', 'composer not left with a copy')
})

test('FIN-1: F9 does not send into another session when the focus moved after opening; it places with the note', { skip }, async () => {
  await toPreview()
  const prompt = $('[data-studio-preview-text]').textContent
  ui.host.state.focusedSessionId.set('sess-other')
  try {
    await press(K().generate)
    assert.equal(composer().submits.length, 0, 'not sent to the other session')
    assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: prompt }, 'placed in its own conversation, never lost')
    assert.notEqual(draft(), prompt, 'the other conversation on screen is not touched')
    assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.placedNotSent), 'placed-not-sent note')
  } finally {
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('FIN-1: when submit is refused (turn running) the prompt is placed in the composer with a short note', { skip }, async () => {
  await toPreview()
  composer().submitResult = false
  const prompt = $('[data-studio-preview-text]').textContent
  await click('[data-studio-send-prompt]')
  assert.equal(composer().submits.length, 1)
  assert.equal(draft(), prompt, 'prompt never lost')
  assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.placedNotSent), 'placed-not-sent note')
  assert.ok($('[data-studio-strip]') === null)
})

test('FIN-1: Alt+E puts the prompt in the composer to edit, never sends', { skip }, async () => {
  await toPreview()
  const prompt = $('[data-studio-preview-text]').textContent
  await press(K().editPrompt, document.activeElement, { code: 'KeyE' })
  assert.equal(composer().submits.length, 0, 'not sent')
  assert.equal(draft(), prompt)
  assert.ok($('[data-studio-strip]') === null)
})

test('KEYS-MAC: Option+E on macOS (dead key in e.key) still works as Alt+E via e.code', { skip }, async () => {
  await toPreview()
  const prompt = $('[data-studio-preview-text]').textContent
  await press(K().editPrompt, document.activeElement, { key: 'Dead', code: 'KeyE' })
  assert.equal(composer().submits.length, 0, 'not sent')
  assert.equal(draft(), prompt)
  assert.ok($('[data-studio-strip]') === null)
})

test('LOAD-1: while the session context is read only a loading state and Cancel (F10) show; options come after', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await click('[data-studio-cancel]')
  let release
  backend.context = () => new Promise(resolve => { release = () => resolve({ ok: true, summary: 'RESUMO', model: 'm', ms: 10 }) })
  backend.calls.length = 0
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  await click('[data-studio-open]')
  assert.ok($('[data-studio-context-loading]'), 'loading state')
  assert.match($('[data-studio-context-loading]').textContent, /Reading this session/)
  for (const sel of ['[data-studio-paste-open]', '[data-studio-skip]', '[data-studio-options]', '[data-studio-ai-row]', '[data-studio-actions]', '[data-studio-generate]', '[data-studio-current-question]']) {
    assert.ok($(sel) === null, `${sel} hidden while reading`)
  }
  assert.ok($('[data-studio-cancel]'), 'Cancel stays')
  assertEverythingHasAKey()
  release()
  await waitFor(() => $('[data-studio-options]'))
  assert.ok($('[data-studio-context-loading]') === null)
  assert.ok($('[data-studio-actions]'))
})

test('LOAD-1: a context read that times out releases the options with a short note', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await click('[data-studio-cancel]')
  backend.context = () => new Promise(() => {})
  globalThis.__promptStudioContextTimeoutMs = 20
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await click('[data-studio-open]')
    assert.ok($('[data-studio-context-loading]'))
    await waitFor(() => $('[data-studio-options]'))
    assert.ok($('[data-studio-context-status]').textContent.includes(ui.i18n.bundles.en.errors.timeout))
  } finally {
    delete globalThis.__promptStudioContextTimeoutMs
  }
})

test('LOAD-1: F10 during the context read closes and returns the draft', { skip }, async () => {
  await freshSettings('sess-1')
  backend.context = () => new Promise(() => {})
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  await click('[data-studio-open]')
  assert.ok($('[data-studio-context-loading]'))
  await press(K().close)
  assert.ok($('[data-studio-strip]') === null)
  assert.equal(draft(), INTENT)
})

test('LOAD-2: Auto, while the step suggestion loads the choices it changes are hidden; they return on arrival or failure', { skip }, async () => {
  let pending = holdSuggest()
  await toEnumStep('auto')
  assert.ok($('[data-studio-ai-loading]'))
  assert.ok($('[data-studio-options]') === null, 'choice cards hidden while loading')
  assert.ok($('[data-studio-ai-stop]'), 'Stop (Alt+D) still there')
  assertEverythingHasAKey()
  pending.at(-1).reject(new Error('boom'))
  await waitFor(() => $('[data-studio-ai-error]'))
  assert.ok($('[data-studio-options]'), 'options back after a failure')
  assert.equal(recommends().length, 1, 'local recommendation back')
  // Text step with a default: the recommended/skip row waits for the suggestion too.
  await freshSettings(null)
  pending = holdSuggest()
  await openStudio(INTENT, 'auto', { deliverable: true })
  await waitFor(() => pending.length > 0)
  pending.at(-1).resolve({ ok: true, value: '', reason: 'x' }) // the deliverable step's suggestion
  await pasteStep('')
  for (let i = 0; i < 12 && !($('[data-studio-answer-input]') && $('[data-studio-ai-loading]') && pending.at(-1)?.body.field.recommended); i += 1) {
    if (pending.length) pending.at(-1).resolve({ ok: true, value: '', reason: 'x' })
    await settle()
    if ($('[data-studio-ai-loading]') && $('[data-studio-answer-input]') && pending.at(-1)?.body.field.recommended) break
    await answerStep()
    await settle()
  }
  if ($('[data-studio-answer-input]') && $('[data-studio-ai-loading]') && pending.at(-1)?.body.field.recommended) {
    assert.ok($('[data-studio-recommend]') === null, 'recommended hidden while loading')
    assert.ok($('[data-studio-answer-input]'), 'the field itself stays')
    pending.at(-1).resolve({ ok: true, value: 'TEXTO DA IA', reason: 'x' })
    await waitFor(() => $('[data-studio-recommend]'))
  }
})

test('LOAD-3: while the AI writes the prompt, only Cancel and the mode switch remain', { skip }, async () => {
  await freshSettings(null)
  let release
  backend.compose = () => new Promise(resolve => { release = () => resolve({ ok: true, prompt: 'P', notes: '' }) })
  await openStudio()
  await click('[data-studio-generate]')
  assert.ok($('[data-studio-generate]') === null, 'Generate hidden while writing')
  assert.ok($('[data-studio-back]') === null, 'Back hidden while writing')
  assert.ok($('[data-studio-cancel]'))
  assert.ok($('[data-studio-ai-mode-option="off"]'))
  release()
  await waitFor(() => $('[data-studio-send-prompt]'))
})

test('SET-1: read-context switch off: no /context and no loading state, persisted; on again: it reads', { skip }, async () => {
  await freshSettings('sess-1')
  await openStudio(INTENT, 'auto')
  await openSettings()
  const sw = () => $('[data-studio-read-context] [role="switch"]')
  assert.ok(sw(), 'switch shown in Settings')
  await click('[data-studio-read-context] [role="switch"]')
  assert.equal(ui.storage.get('readContext'), false, 'persisted in ctx.storage')
  await closeSettings()
  await openFresh()
  assert.equal(contextCalls().length, 0)
  assert.ok($('[data-studio-context-loading]') === null)
  assert.ok($('[data-studio-context-status]') === null)
  assert.ok($('[data-studio-options]'), 'options shown at once')
  await openSettings()
  assert.equal(sw().getAttribute('aria-checked'), 'false', 'reads back off after reopening')
  await click('[data-studio-read-context] [role="switch"]')
  assert.equal(ui.storage.get('readContext'), true)
  await closeSettings()
  await openFresh()
  await waitFor(() => contextCalls().length === 1 && $('[data-studio-context-status]'))
  assert.equal(contextCalls().length, 1, 'on: it reads')
})

test('SDK-1: the Settings rows use the SDK ListRow/ToggleRow when present and the built-in fallbacks otherwise', { skip }, async () => {
  await freshSettings(null)
  await openStudio(INTENT, 'auto')
  await openSettings()
  const sw = $('[data-studio-read-context] [role="switch"]')
  assert.ok(sw, 'a switch is shown')
  if (LEGACY_SDK) {
    assert.ok($('[data-sdk-list-row]') === null && $('[data-sdk-toggle]') === null, 'no SDK rows on a legacy SDK')
    assert.ok($('[data-studio-settings-dialog] [data-studio-list-row]'), 'fallback ListRow rendered')
    assert.equal(sw.tagName, 'BUTTON', 'fallback switch is a real button (Space/Enter, focusable)')
    assert.equal(sw.getAttribute('aria-checked'), 'true')
    assert.ok(sw.getAttribute('aria-label') || sw.getAttribute('aria-labelledby'), 'switch is labelled')
  } else {
    assert.ok($('[data-sdk-list-row]') && $('[data-sdk-toggle]'), 'SDK rows used when the SDK has them')
    assert.ok($('[data-studio-list-row]') === null, 'no fallback when the SDK has ListRow')
  }
  await click('[data-studio-read-context] [role="switch"]')
  assert.equal(ui.storage.get('readContext'), false)
  assert.equal($('[data-studio-read-context] [role="switch"]').getAttribute('aria-checked'), 'false')
  await click('[data-studio-read-context] [role="switch"]')
  assert.equal(ui.storage.get('readContext'), true)
  await closeSettings()
})

test('SDK composer: the draft is read and written only through host.composer, addressed to its conversation', { skip }, async () => {
  resetComposer()
  await openStudio()
  assert.equal(draft(), '', 'composer emptied when the studio opens')
  assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: '' })
  await click('[data-studio-cancel]')
  await waitFor(() => draft() === INTENT)
  assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: INTENT }, 'Close returns the draft to its own conversation through setDraft')
})

test('SDK composer: a host without host.composer tells the user to update Hermes and does not open', { skip }, async () => {
  const saved = ui.host.composer
  ui.host.composer = undefined
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    ui.notifications.length = 0
    await click('[data-studio-open]')
    assert.ok($('[data-studio-strip]') === null, 'studio not opened')
    assert.ok(ui.notifications.some(n => n.kind === 'error' && n.message === ui.i18n.bundles.en.notify.needsComposer), 'update note')
    assert.equal(draft(), INTENT, 'draft untouched')
  } finally {
    ui.host.composer = saved
  }
})

test('SDK composer: when setDraft is refused the preview stays open with an error and nothing is lost', { skip }, async () => {
  await toPreview()
  globalThis.__promptStudioSetDraftFails = true
  try {
    ui.notifications.length = 0
    await click('[data-studio-use-prompt]')
    assert.ok($('[data-studio-preview]'), 'preview still open')
    assert.ok(ui.notifications.some(n => n.kind === 'error' && n.message === ui.i18n.bundles.en.notify.placeFailed), 'error shown')
  } finally {
    globalThis.__promptStudioSetDraftFails = false
    await click('[data-studio-cancel]')
  }
})

test('Attachments: the preview warns in the destructive color that Send now does not carry attachments', { skip }, async () => {
  await toPreview()
  const note = $('[data-studio-attachments-note]')
  assert.ok(note, 'note shown on the preview')
  assert.equal(note.textContent, ui.i18n.bundles.en.preview.attachmentsNote)
  assert.match(note.getAttribute('style'), /var\(--dt-destructive\)/)
  await click('[data-studio-cancel]')
})

test('SDK composer: no active composer (getDraft null) says so instead of "empty", and does not open', { skip }, async () => {
  globalThis.__promptStudioNoActiveComposer = true
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    ui.notifications.length = 0
    await click('[data-studio-open]')
    assert.ok($('[data-studio-strip]') === null, 'studio not opened')
    assert.ok(ui.notifications.some(n => n.kind === 'error' && n.message === ui.i18n.bundles.en.notify.readFailed), 'read-failed note')
    assert.ok(!ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.empty), 'not reported as empty')
  } finally {
    globalThis.__promptStudioNoActiveComposer = false
  }
})

// Holds every host.composer call until release() runs.
function holdComposer() {
  let release
  globalThis.__promptStudioComposerGate = new Promise(resolve => { release = resolve })
  return async () => { globalThis.__promptStudioComposerGate = undefined; release(); await settle() }
}

test('SDK composer: F4 pressed again while the draft is being read opens the studio once', { skip }, async () => {
  resetComposer()
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  const release = holdComposer()
  await press(K().open)
  await press(K().open)
  await release()
  await waitFor(() => $('[data-studio-strip]'))
  assert.equal(composer().writes.filter(w => w.text === '').length, 1, 'composer emptied once')
  await click('[data-studio-cancel]')
})

test('SDK composer: a second Alt+E or F9, or Close, while the prompt is being placed does nothing', { skip }, async () => {
  await toPreview()
  resetComposer()
  const prompt = $('[data-studio-preview-text]').textContent
  const release = holdComposer()
  await press(K().editPrompt)
  await press(K().editPrompt)
  await press(K().close)
  composer().submitResult = false
  await press(K().generate)
  await release()
  await waitFor(() => $('[data-studio-strip]') === null)
  assert.deepEqual(composer().writes.map(w => w.text), [prompt], 'one write: the prompt, never the old draft')
  assert.equal(draft(), prompt)
  assert.equal(composer().submits.length, 0, 'F9 ignored while placing')
})

test('SDK composer: the composer focus retries after setDraft do not take the focus back from the studio', { skip }, async () => {
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  $('[data-slot="composer-rich-input"]').focus()
  await press(K().open)
  await waitFor(() => $('[data-studio-strip]'))
  // Let every deferred retry (0 ms timers and animation frames) run.
  await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
  await settle()
  const strip = $('[data-studio-strip]')
  assert.ok(strip && strip.contains(document.activeElement), 'focus stays in the studio')
  await click('[data-studio-cancel]')
})

// Switch the focused session while the Studio is opening (during the wait for the app's focus retries).
async function openWhileSwitching() {
  resetComposer()
  backend.calls.length = 0
  ui.notifications.length = 0
  globalThis.__promptStudioFocusSettleMs = 40
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await press(K().open)
    ui.host.state.focusedSessionId.set('sess-other')
    await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    await settle()
  } finally {
    globalThis.__promptStudioFocusSettleMs = 0
  }
}

test('SDK composer: switching conversations while the Studio opens returns the draft to its own conversation', { skip }, async () => {
  try {
    await openWhileSwitching()
    assert.ok($('[data-studio-strip]') === null, 'studio not opened on the other conversation')
    assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: INTENT }, 'draft back to its session')
    assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.sessionChanged))
    assert.equal(backend.calls.length, 0, 'no context read of the other conversation')
  } finally {
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: when the original conversation is not on screen any more the draft is copied to the clipboard', { skip }, async () => {
  globalThis.__promptStudioSessionUnmounted = true
  const clipboard = ui.pluginContext.os.clipboard
  clipboard.length = 0
  try {
    await openWhileSwitching()
    assert.ok($('[data-studio-strip]') === null, 'studio not opened')
    assert.deepEqual(clipboard, [INTENT])
    assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.sessionChangedCopied))
  } finally {
    globalThis.__promptStudioSessionUnmounted = false
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: original conversation gone and clipboard refused: the draft is added below the other conversation draft', { skip }, async () => {
  globalThis.__promptStudioSessionUnmounted = true
  globalThis.__promptStudioClipboardFails = true
  try {
    resetComposer()
    ui.notifications.length = 0
    globalThis.__promptStudioFocusSettleMs = 40
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await press(K().open)
    // The user lands on conversation B, which has its own unsent draft.
    ui.host.state.focusedSessionId.set('sess-other')
    await ui.act(async () => { $('[data-slot="composer-rich-input"]').textContent = 'rascunho da conversa B' })
    await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    await settle()
    assert.ok($('[data-studio-strip]') === null, 'studio not opened')
    assert.equal(draft(), `rascunho da conversa B\n${INTENT}`, "B's draft kept, A's draft added below")
    assert.deepEqual(composer().inserts, [{ sessionId: null, text: INTENT, mode: 'block' }])
    assert.equal(composer().submits.length, 0, 'not sent')
    assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.sessionChangedHere))
  } finally {
    globalThis.__promptStudioFocusSettleMs = 0
    globalThis.__promptStudioSessionUnmounted = false
    globalThis.__promptStudioClipboardFails = false
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: when every place refuses the draft, the error notice carries the draft text', { skip }, async () => {
  globalThis.__promptStudioSessionUnmounted = true
  globalThis.__promptStudioClipboardFails = true
  try {
    resetComposer()
    ui.notifications.length = 0
    globalThis.__promptStudioFocusSettleMs = 40
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await press(K().open)
    ui.host.state.focusedSessionId.set('sess-other')
    globalThis.__promptStudioSetDraftFails = true
    await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    await settle()
    assert.ok($('[data-studio-strip]') === null, 'studio not opened')
    const lost = ui.notifications.find(n => n.kind === 'error')
    assert.ok(lost && lost.message.includes(INTENT), 'the draft text is in the notice')
  } finally {
    globalThis.__promptStudioFocusSettleMs = 0
    globalThis.__promptStudioSetDraftFails = false
    globalThis.__promptStudioSessionUnmounted = false
    globalThis.__promptStudioClipboardFails = false
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: while the prompt is being placed, Alt+V and Back to steps do nothing and the buttons are disabled', { skip }, async () => {
  backend.compose = () => ({ ok: true, prompt: 'PROMPT DA IA', notes: 'ok' })
  await toPreview()
  resetComposer()
  const release = holdComposer()
  const prompt = $('[data-studio-preview-text]').textContent
  await press(K().editPrompt)
  for (const sel of ['[data-studio-send-prompt]', '[data-studio-use-prompt]', '[data-studio-back-to-steps]', '[data-studio-cancel]']) {
    assert.equal($(sel).disabled, true, `${sel} disabled while placing`)
  }
  if ($('[data-studio-switch-version]')) assert.equal($('[data-studio-switch-version]').disabled, true)
  await press(K().version)
  await press(K().back)
  await release()
  await waitFor(() => $('[data-studio-strip]') === null)
  assert.equal(draft(), prompt, 'the prompt shown when Alt+E was pressed is placed and the studio closed')
  assert.deepEqual(composer().writes.map(w => w.text), [prompt])
})

// A host dispose (plugin disabled or hot reload): every tracked disposer runs (listeners, timers,
// onDispose), then the plugin registers again, as the Desktop loader does on reload.
async function hostReload() {
  await ui.act(async () => {
    for (const off of ui.disposers.splice(0)) off()
    ui.plugin.register(ui.pluginContext)
  })
  await ui.act(async () => {
    ui.roots[0].render(ui.jsx(() => ui.slots.top.render(), {}))
    ui.roots[1].render(ui.jsx(() => ui.slots.actions.render(), {}))
  })
  await settle()
}

test('SDK composer: a dispose while the Studio is opening gives the draft back to the composer', { skip }, async () => {
  resetComposer()
  globalThis.__promptStudioFocusSettleMs = 40
  try {
    $('[data-slot="composer-rich-input"]').textContent = INTENT
    await press(K().open)
    assert.equal(draft(), '', 'composer emptied, studio not open yet')
    await hostReload()
    await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    await settle()
    assert.ok($('[data-studio-strip]') === null, 'the cut-short opening never continues')
    assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: INTENT }, 'draft back in its composer')
  } finally {
    globalThis.__promptStudioFocusSettleMs = 0
  }
  await openStudio()
  assert.ok($('[data-studio-strip]'), 'the reloaded plugin opens normally')
  await click('[data-studio-cancel]')
})

test('SDK composer: a dispose while the Studio is open gives the draft back to the composer', { skip }, async () => {
  resetComposer()
  await openStudio()
  assert.equal(draft(), '')
  await hostReload()
  assert.ok($('[data-studio-strip]') === null, 'studio closed by the dispose')
  assert.deepEqual(composer().writes.at(-1), { sessionId: 'sess-live', text: INTENT }, 'draft back in its composer')
})

test('SDK composer: a dispose after switching conversations never writes the fresh-chat draft into the other one', { skip }, async () => {
  ui.host.state.focusedSessionId.set(null)
  try {
    resetComposer()
    await openStudio()
    ui.host.state.focusedSessionId.set('sess-other')
    await ui.act(async () => { $('[data-slot="composer-rich-input"]').textContent = 'rascunho da conversa B' })
    await hostReload()
    await settle()
    assert.equal(draft(), 'rascunho da conversa B', "B's draft untouched")
    assert.deepEqual(composer().writes.at(-1), { sessionId: 'new', text: INTENT }, "addressed to the fresh chat ('new'), never null")
  } finally {
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: a dispose with the original conversation gone copies the draft to the clipboard', { skip }, async () => {
  const clipboard = ui.pluginContext.os.clipboard
  clipboard.length = 0
  resetComposer()
  await openStudio()
  ui.host.state.focusedSessionId.set('sess-other')
  globalThis.__promptStudioSessionUnmounted = true
  try {
    ui.notifications.length = 0
    await hostReload()
    await settle()
    assert.deepEqual(clipboard, [INTENT], 'draft on the clipboard, not lost')
    assert.ok(ui.notifications.some(n => n.message === ui.i18n.bundles.en.notify.draftBackCopied))
  } finally {
    globalThis.__promptStudioSessionUnmounted = false
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: text typed in the composer while the Studio is open is kept on Close and on dispose', { skip }, async () => {
  for (const finish of ['close', 'dispose']) {
    resetComposer()
    await openStudio()
    await ui.act(async () => { $('[data-slot="composer-rich-input"]').textContent = 'texto novo' })
    if (finish === 'close') await click('[data-studio-cancel]')
    else await hostReload()
    await settle()
    assert.equal(draft(), `texto novo\n${INTENT}`, `${finish}: the new text kept, the request added below`)
  }
})

test('SDK composer: a saved conversation with no runtime id yet is addressed by its stored id, not as a new chat', { skip }, async () => {
  resetComposer()
  await freshSettings('stored-1')
  ui.host.state.focusedSessionId.set(null)
  try {
    await openStudio(INTENT, 'off')
    await click('[data-studio-generate]')
    await waitFor(() => $('[data-studio-preview]'))
    const prompt = $('[data-studio-preview-text]').textContent
    await click('[data-studio-use-prompt]')
    await waitFor(() => $('[data-studio-strip]') === null)
    assert.equal(draft(), prompt, 'prompt placed in that conversation')
    assert.deepEqual(composer().writes.at(-1), { sessionId: 'stored-1', text: prompt }, 'addressed by its stored id')
  } finally {
    ui.host.state.focusedStoredSessionId.set(null)
    ui.host.state.focusedSessionId.set('sess-live')
  }
})

test('SDK composer: with two panes, F4 reads and clears the focused conversation, never the other pane typed in last', { skip }, async () => {
  resetComposer()
  composer().offscreen.set('sess-a', 'rascunho do painel A')
  globalThis.__promptStudioActiveComposer = 'sess-a'
  try {
    await openStudio('rascunho da conversa B em foco')
    assert.match($('[data-studio-intent-row]').textContent, /rascunho da conversa B em foco/, 'the focused conversation draft')
    assert.equal(composer().offscreen.get('sess-a'), 'rascunho do painel A', 'pane A untouched')
    await click('[data-studio-cancel]')
    await waitFor(() => draft() === 'rascunho da conversa B em foco')
    assert.equal(composer().offscreen.get('sess-a'), 'rascunho do painel A', 'pane A still untouched after Close')
  } finally {
    globalThis.__promptStudioActiveComposer = undefined
  }
})

test('SDK composer: a dispose while the prompt is being placed keeps the prompt and does not bring the request back over it', { skip }, async () => {
  await toPreview()
  resetComposer()
  const prompt = $('[data-studio-preview-text]').textContent
  const release = holdComposer()
  await press(K().editPrompt)
  await hostReload()
  await release()
  await settle()
  assert.equal(draft(), prompt, 'the placed prompt, alone')
  assert.ok(!draft().includes(INTENT) || prompt.includes(INTENT), 'the original request was not added')
})

test('SDK composer: a dispose while a placement that fails is pending brings the request back after it', { skip }, async () => {
  await toPreview()
  resetComposer()
  const release = holdComposer()
  await press(K().editPrompt)
  // The placement is refused (its conversation left the screen); the restore that follows is accepted.
  let refused = 0
  const setDraft = composer().setDraft
  composer().setDraft = async function (sessionId, text) {
    if (text !== INTENT && refused === 0) { refused += 1; await globalThis.__promptStudioComposerGate; return false }
    return setDraft.call(this, sessionId, text)
  }
  try {
    await hostReload()
    await release()
    await settle()
  } finally {
    composer().setDraft = setDraft
  }
  assert.equal(refused, 1, 'the placement ran first and was refused')
  assert.equal(draft(), INTENT, 'then the request came back, not lost')
})

// Disable without registering again: the host runs every disposer and the context is gone afterwards.
async function hostDisable() {
  await ui.act(async () => { for (const off of ui.disposers.splice(0)) off() })
  await settle()
}

test('SDK composer: disabled while a refused placement is pending, the request still reaches the clipboard', { skip }, async () => {
  await toPreview()
  resetComposer()
  const clipboard = ui.pluginContext.os.clipboard
  clipboard.length = 0
  const release = holdComposer()
  await press(K().editPrompt)
  // The conversation leaves the screen: the placement and the restore to it are both refused.
  ui.host.state.focusedSessionId.set('sess-other')
  globalThis.__promptStudioSessionUnmounted = true
  try {
    await hostDisable()
    await release()
    await settle()
    assert.deepEqual(clipboard, [INTENT], 'the clipboard API taken at dispose time was used')
  } finally {
    globalThis.__promptStudioSessionUnmounted = false
    ui.host.state.focusedSessionId.set('sess-live')
    await ui.act(async () => { ui.plugin.register(ui.pluginContext) })
    await ui.act(async () => {
      ui.roots[0].render(ui.jsx(() => ui.slots.top.render(), {}))
      ui.roots[1].render(ui.jsx(() => ui.slots.actions.render(), {}))
    })
    await settle()
  }
})

test('SDK composer: disabled while the composer is being cleared, a refused restore still reaches the clipboard', { skip }, async () => {
  resetComposer()
  const clipboard = ui.pluginContext.os.clipboard
  clipboard.length = 0
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  // The clear ('') waits for release and succeeds; every later write is refused (the composer left the screen).
  let release
  const gate = new Promise(resolve => { release = resolve })
  const setDraft = composer().setDraft
  composer().setDraft = async function (sessionId, text) {
    if (text !== '') return false
    await gate
    return setDraft.call(this, sessionId, text)
  }
  const insertText = composer().insertText
  composer().insertText = async () => false
  try {
    await press(K().open)
    await hostDisable()
    release()
    await settle()
    assert.equal(draft(), '', 'the draft left the composer')
    assert.deepEqual(clipboard, [INTENT], 'the clipboard API taken before the await was used')
  } finally {
    composer().setDraft = setDraft
    composer().insertText = insertText
    await ui.act(async () => { ui.plugin.register(ui.pluginContext) })
    await ui.act(async () => {
      ui.roots[0].render(ui.jsx(() => ui.slots.top.render(), {}))
      ui.roots[1].render(ui.jsx(() => ui.slots.actions.render(), {}))
    })
    await settle()
  }
})

test('SDK composer: a composer whose draft cannot be read gets the prompt appended, never written over', { skip }, async () => {
  await toPreview()
  resetComposer()
  const prompt = $('[data-studio-preview-text]').textContent
  await ui.act(async () => { $('[data-slot="composer-rich-input"]').textContent = 'texto que ninguém leu' })
  const getDraft = composer().getDraft
  composer().getDraft = async () => null
  try {
    await click('[data-studio-use-prompt]')
    await waitFor(() => $('[data-studio-strip]') === null)
  } finally {
    composer().getDraft = getDraft
  }
  assert.equal(draft(), `texto que ninguém leu\n${prompt}`, 'existing text kept, prompt below')
  assert.equal(composer().writes.length, 0, 'no setDraft over unread text')
})

