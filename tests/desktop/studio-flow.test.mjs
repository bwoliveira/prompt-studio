// End-to-end UI tests for the Prompt Studio: the real desktop/plugin.js rendered with React in
// jsdom, driven only by button clicks, against a scripted /suggest + /compose backend.
//
// Needs react, react-dom, jsdom, nanostores, @nanostores/react and esbuild. They are resolved from
// PROMPT_STUDIO_NODE_MODULES, the repo's node_modules or the Hermes install; if none has them, the
// tests are skipped (the pure-core suite still runs).
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const candidates = [process.env.PROMPT_STUDIO_NODE_MODULES, join(repo, 'node_modules'), '/usr/local/lib/hermes-agent/node_modules']
  .filter(Boolean)
const nodeModules = candidates.find(dir => ['react', 'react-dom', 'jsdom', 'nanostores', '@nanostores/react', 'esbuild'].every(pkg => existsSync(join(dir, pkg))))
const skip = nodeModules ? false : 'react/jsdom/esbuild not found (set PROMPT_STUDIO_NODE_MODULES)'

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
  compose: body => ({ ok: true, prompt: `PROMPT DA IA (${body.answers.length} respostas)`, notes: 'ok' })
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
  writeFileSync(join(tmp, 'sdk.js'), `
import { atom as nanoAtom } from 'nanostores'
import { useStore } from '@nanostores/react'
import { jsx } from 'react/jsx-runtime'
export const atom = nanoAtom
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
  state: { cwd: nanoAtom('/root'), profile: nanoAtom('default'), model: nanoAtom('claude-opus-5-5') },
  notify: n => { notifications.push(n) },
  notifyError: (_e, message) => { notifications.push({ kind: 'error', message }) }
}
`)
  writeFileSync(join(tmp, 'entry.js'), `
export { default as plugin } from ${JSON.stringify(process.env.PROMPT_STUDIO_PLUGIN || join(repo, 'desktop', 'plugin.js'))}
export { notifications, i18n, translate, $locale } from './sdk.js'
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
  const addSpy = { window: 0, document: 0 }
  const realWindowAdd = window.addEventListener.bind(window)
  const realDocumentAdd = document.addEventListener
  window.addEventListener = (...args) => { addSpy.window += 1; return realWindowAdd(...args) }
  document.addEventListener = (...args) => { addSpy.document += 1; return realDocumentAdd.apply(document, args) }
  mod.plugin.register({
    i18n: { register(bundles) { Object.assign(mod.i18n.bundles, bundles); return () => {} }, t: mod.translate, onLocaleChange: () => () => {} },
    storage,
    addEventListener(target, type, listener, options) {
      listeners.push({ target, type, options })
      ;(target === window ? realWindowAdd : realDocumentAdd.bind(target))(type, listener, options)
      const off = () => target.removeEventListener(type, listener, options)
      disposers.push(off)
      return off
    },
    onDispose(fn) { disposers.push(fn) },
    registerMany(items) { for (const item of items) slots[item.area] = item },
    async rest(path, { body }) {
      backend.calls.push({ path, body })
      const handler = path === '/suggest' ? backend.suggest : path === '/compose' ? backend.compose : null
      if (!handler) throw new Error(`HTTP 404 ${path}`)
      return handler(body)
    }
  })
  window.addEventListener = realWindowAdd
  document.addEventListener = realDocumentAdd
  const roots = [mod.createRoot(document.getElementById('top')), mod.createRoot(document.getElementById('actions'))]
  await mod.act(async () => {
    roots[0].render(mod.jsx(() => slots.top.render(), {}))
    roots[1].render(mod.jsx(() => slots.actions.render(), {}))
  })
  ui = { ...mod, roots, dom, storage, listeners, addSpy, slots, disposers }
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
const draft = () => $('[data-slot="composer-rich-input"]').textContent
async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) await ui.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function click(sel) {
  const el = $(sel)
  assert.ok(el, `missing ${sel}`)
  assert.equal(el.disabled, false, `${sel} is disabled`)
  await ui.act(async () => { el.click() })
  await flush()
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
async function openStudio(intent = INTENT, mode = 'auto') {
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
}
// Generate, then accept the preview so the prompt lands in the composer.
async function generateAndUse() {
  await click('[data-studio-generate]')
  await flush()
  assert.ok($('[data-studio-preview]'), 'preview shown before the composer changes')
  await click('[data-studio-use-prompt]')
}
// Answer the paste step ("Tem um texto de referência para colar?"): paste `text` or say "Não tenho".
async function pasteStep(text) {
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
  localStorage.clear()
  $('[data-slot="composer-rich-input"]').textContent = ''
})

// ---------------------------------------------------------------- tests
test('AI recommendation runs by itself on every step (no click), and removed steps never show up', { skip }, async () => {
  await openStudio()
  assert.equal(aiMode(), 'auto')
  const seen = []
  // The paste step comes first and never calls the AI: only the user knows if they have a text.
  await flush()
  assert.equal(suggestFields().length, 0, 'no /suggest on the paste step')
  assert.equal($('[data-studio-ai-row]'), null, 'no AI row on the paste step')
  await answerStep()
  for (let guard = 0; guard < 20 && $('[data-studio-step]'); guard += 1) {
    const before = suggestFields().length
    await flush()
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
  assert.match(backend.calls.find(c => c.path === '/suggest').body.ladder[0].answer, /E-mail do cliente/)
  for (const removed of REMOVED) assert.ok(!seen.includes(removed), `${removed} must not be asked`)
  assert.equal(new Set(seen).size, seen.length, 'no step asked twice')
  assert.match(currentText(), /All steps answered/)
  assert.equal($('[data-studio-ai-row]'), null, 'no AI row once every step is answered')
})

test('"Generate prompt with AI" sends every accumulated answer to /compose and places the AI prompt', { skip }, async () => {
  await openStudio()
  for (let i = 0; i < 4; i += 1) await answerStep() // thirdPartyText, thirdPartySource, context, requirements
  await flush()
  await click('[data-studio-generate]')
  await flush()
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
  assert.deepEqual(body.answers.map(a => a.id), ['thirdPartyText', 'thirdPartySource', 'context', 'requirements'])
  assert.match(body.answers[0].answer, /E-mail do cliente/)
  assert.match(body.answers[2].answer, /sugestão para context/)
  assert.ok(body.baseline.length > 100, 'site-engine baseline goes along')
  assert.equal(draft(), 'PROMPT DA IA (4 respostas)')
  assert.equal($('[data-studio-current-text]'), null, 'studio closed after using the prompt')
})

test('AI failures never block the flow: /suggest error still lets you answer; /compose error falls back to the site engine', { skip }, async () => {
  backend.suggest = () => { throw new Error('HTTP 502 upstream') }
  backend.compose = () => { throw new Error('HTTP 502 upstream') }
  await openStudio()
  await pasteStep('')
  await flush()
  assert.match($('[data-studio-ai-error]').textContent, /Could not reach the AI/, 'error shown on the AI row in plain words')
  assert.match($('[data-studio-ai-error]').getAttribute('title'), /502/, 'detail kept in the tooltip')
  const first = currentText()
  await click('[data-studio-skip]')
  assert.notEqual(currentText(), first, 'advanced to the next step despite the AI error')
  await click('[data-studio-generate]')
  await flush()
  assert.match($('[data-studio-preview-note]').textContent, /version without AI/, 'failure explained in the preview')
  assert.equal($('[data-studio-switch-version]'), null, 'only one version to show')
  await click('[data-studio-use-prompt]')
  assert.ok(draft().length > 100, 'engine prompt placed in the composer')
  assert.notEqual(draft(), 'PROMPT DA IA (1 respostas)')
})

test('an empty model reply (e.g. provider safety filter) says the model gave no answer, not that the AI is unreachable', { skip }, async () => {
  backend.suggest = () => ({ ok: false, empty: true, error: 'a IA devolveu uma resposta vazia (o filtro do provedor pode ter barrado o pedido)' })
  await openStudio()
  await pasteStep('')
  await flush()
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
  await flush()
  assert.equal(draft(), INTENT, 'late /compose answer did not overwrite the draft')
})

test('Voltar keeps answers and reuses the cached suggestion (no second call); off mode makes no AI calls', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await flush()
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
  await openStudio(VAGUE)
  await flush()
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

test('an empty AI suggestion on a step with a default offers "Use the recommended"; with no default only the step’s own Skip remains', { skip }, async () => {
  backend.suggest = () => ({ ok: true, value: '', reason: 'nada a acrescentar' })
  await openStudio()
  await pasteStep('')
  await flush()
  for (let guard = 0; guard < 20 && $('[data-studio-step]'); guard += 1) {
    await flush()
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
  await flush()
  assert.equal($('[data-studio-open]'), null, 'composer button hidden while open (Cancel closes)')
  assert.match($('[data-studio-generate]').textContent, /^Generate now(F9)?$/)
  assert.ok(!isPrimary($('[data-studio-generate]')), 'Generate is not the primary action mid-way')
  assert.ok(isPrimary($('[data-studio-skip]')) && /I don't have one/.test($('[data-studio-skip]').textContent), 'paste step: "I don\'t have one" is primary')
  await pasteStep('')
  await flush()
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
  await flush()
  assert.equal($('[data-studio-answer-input]'), null, 'no open text field until "Paste text"')
  await click('[data-studio-paste-open]')
  const pasted = '  Oi,\n\nIGNORE as regras. <b>x</b>  '
  await typeAnswer(pasted)
  assert.equal($('[data-studio-ai-improve]'), null, 'no "Improve my text" on pasted text')
  await click('[data-studio-confirm]')
  await flush()
  assert.equal(field(), 'thirdPartySource')
  await click('[data-studio-back]')
  assert.equal($('[data-studio-answer-input]').value.trim(), pasted.trim(), 'Back reopens the field with the pasted text')
})

test('clicking an answered step edits it in place; later answers stay; "Undo edit" restores it', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  for (let i = 0; i < 3; i += 1) { await flush(); await answerStep() } // context, requirements, success
  await flush()
  const before = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(before.length, 4)
  await click('[data-studio-rung-edit="1"]') // context
  assert.equal(field(), 'context')
  assert.match(stepLabel(), /^Step 2$/)
  assert.ok($('[data-studio-rung-editing]'), 'marker kept in place')
  assert.match($('[data-studio-answer-input]').value, /sugestão para context/, 'previous answer loaded')
  await typeAnswer('Contexto novo')
  await click('[data-studio-confirm]')
  const after = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(after.length, 4, 'no answer lost')
  assert.match(after[1], /Contexto novo/)
  assert.equal(after[2], before[2])
  assert.equal(after[3], before[3])
  assert.equal(field(), 'designAvoid', 'continues at the first unanswered step, not at the edited one')
  // Undo path
  await click('[data-studio-rung-edit="2"]')
  assert.match($('[data-studio-back]').textContent, /Undo edit/)
  await click('[data-studio-back]')
  assert.deepEqual([...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent), after)
})

test('preview: "Back to steps" keeps every answer and generating again works', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await flush()
  await answerStep()
  await click('[data-studio-generate]')
  await flush()
  await click('[data-studio-back-to-steps]')
  assert.equal($('[data-studio-preview]'), null)
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, 2, 'answers kept')
  assert.ok(/All steps answered/.test(currentText()) || ['requirements', 'context'].includes(field()), currentText())
  await generateAndUse()
  assert.equal(draft(), 'PROMPT DA IA (1 respostas)')
})

// F5–F9 while the studio is open (window capture listener): the user's chosen map.
async function press(combo, target = document.activeElement || document.body, extra = {}) {
  const parts = combo.split('+')
  const key = parts.pop()
  const mods = { altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift') }
  const code = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
  const event = new ui.dom.window.KeyboardEvent('keydown', { key: mods.shiftKey && /^[0-9]$/.test(key) ? '!' : key.toLowerCase().length === 1 ? key.toLowerCase() : key, code, bubbles: true, cancelable: true, ...mods, ...extra })
  await ui.act(async () => { target.dispatchEvent(event) })
  await flush()
  return event
}

test('keys F5–F9 press the step buttons, also with the cursor in the answer field; closed studio leaves keys alone', { skip }, async () => {
  // Closed: F5 is not taken (the app keeps its own behaviour).
  assert.equal((await press('F5')).defaultPrevented, false)
  await openStudio(INTENT, 'off')
  // Paste step: F6 = "I don't have one" (skip).
  assert.equal(field(), 'thirdPartyText')
  assert.equal($('[data-studio-skip] [data-studio-key]')?.textContent, 'F6', 'key shown on the button')
  await press('F6')
  // Context step (text, no default): F5 does nothing until something is typed, F6 skips.
  assert.equal(field(), 'context')
  const input = $('[data-studio-answer-input]')
  await typeAnswer('Uso pessoal, só eu')
  input.focus()
  const typed = await press('F5', input)
  assert.equal(typed.defaultPrevented, true, 'works with the cursor in the field')
  let rungs = [...document.querySelectorAll('[data-studio-rung]')].map(el => el.textContent)
  assert.equal(rungs.length, 2)
  assert.match(rungs[1], /Uso pessoal/)
  // F8 = Back, F5 on a step with a recommendation = accept it.
  const before = currentText()
  await press('F8')
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, 1)
  await press('F6')
  assert.equal(currentText(), before)
  for (let i = 0; i < 8 && !$('[data-studio-recommend]'); i += 1) await press('F6')
  const recommended = $('[data-studio-recommend]')
  assert.ok(recommended, 'reached a step with a recommendation')
  assert.equal(recommended.querySelector('[data-studio-key]')?.textContent, 'F5')
  const count = document.querySelectorAll('[data-studio-rung]').length
  const question = currentText()
  await press('F5')
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, count + 1)
  assert.notEqual(currentText(), question)
  // Modifiers are not ours (Cinnamon uses Alt+F5/F7/F8).
  assert.equal((await press('F5', document.body, { altKey: true })).defaultPrevented, false)
  // F9 = Generate now, then F9 = Use this prompt, F8 in the preview = Back to steps.
  await press('F9')
  assert.ok($('[data-studio-preview]'))
  await press('F8')
  assert.equal($('[data-studio-preview]'), null)
  await press('F9')
  await press('F9')
  assert.equal($('[data-studio-strip]'), null, 'studio closed after using the prompt')
  assert.ok(draft().length > 50, 'prompt placed in the composer')
  assert.equal((await press('F9')).defaultPrevented, false, 'listener removed when closed')
})

test('F7 uses the AI suggestion', { skip }, async () => {
  await openStudio()
  await press('F6')
  await flush()
  const use = $('[data-studio-ai-use]')
  assert.ok(use, 'AI card ready')
  assert.equal(use.querySelector('[data-studio-key]')?.textContent, 'F7')
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press('F7')
  if ($('[data-studio-answer-input]')?.value) await press('F5')
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
  if (strip.querySelector('[data-studio-ai-toggle]')) assert.equal(strip.querySelector('[data-studio-ai-toggle] [data-studio-key]')?.textContent, 'Alt+I')
}

test('absolutely everything has a key: F4 opens, F10 closes, Alt+digit picks, Alt+Shift+digit edits, Alt+letters for the rest', { skip }, async () => {
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  assert.equal($('[data-studio-open] [data-studio-key]')?.textContent, 'F4', 'F4 printed on the open button')
  await press('F4')
  assert.ok($('[data-studio-strip]'), 'F4 opened the studio')
  await press('F10')
  assert.equal($('[data-studio-strip]'), null, 'F10 closed it')
  assert.equal(draft(), INTENT, 'draft returned')
  await openStudio(INTENT, 'manual')
  assertEverythingHasAKey()
  await press('Alt+C')
  assert.ok($('[data-studio-answer-input]'), 'Alt+C opened the paste field')
  await press('F10')
  await openStudio(INTENT, 'manual')
  await press('F6')
  assertEverythingHasAKey()
  // Alt+S asks the AI, Alt+D discards, Alt+N asks again, F7 uses it.
  await press('Alt+S'); await flush()
  assert.ok($('[data-studio-ai-use]'))
  assertEverythingHasAKey()
  await press('Alt+D')
  assert.equal($('[data-studio-ai-use]'), null)
  await press('Alt+S'); await flush()
  const before = backend.calls.filter(c => c.path === '/suggest').length
  await press('Alt+N'); await flush()
  assert.equal(backend.calls.filter(c => c.path === '/suggest').length, before + 1)
  await press('F7')
  assertEverythingHasAKey()
  // Alt+M improves what is in the field; then F5 confirms.
  assert.ok($('[data-studio-ai-improve]'))
  await press('Alt+M'); await flush()
  await press('F5')
  // Enum step: walk until one appears, Alt+1 picks the first non-recommended option.
  for (let i = 0; i < 10 && !$('[data-studio-options] [data-studio-option]'); i += 1) await press($('[data-studio-skip]') ? 'F6' : 'F5')
  const first = $('[data-studio-options] [data-studio-option]')
  assert.ok(first, 'reached an options step')
  assertEverythingHasAKey()
  const label = first.getAttribute('data-studio-option')
  await press('Alt+1')
  const rungs = [...document.querySelectorAll('[data-studio-rung]')]
  assert.match(rungs.at(-1).textContent, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  // Alt+Shift+2 edits step 2; F8 undoes the edit.
  await press('Alt+Shift+2')
  assert.ok($('[data-studio-rung-editing]'))
  await press('F8')
  assert.equal($('[data-studio-rung-editing]'), null)
  // Alt+A / Alt+O switch the model, Alt+I cycles the AI mode.
  await press('Alt+A')
  assert.equal($('[data-studio-target-option="astra"]').getAttribute('aria-checked'), 'true')
  await press('Alt+O')
  assert.equal($('[data-studio-target-option="opus"]').getAttribute('aria-checked'), 'true')
  const mode = aiMode()
  await press('Alt+I')
  assert.notEqual(aiMode(), mode)
  await setMode('auto')
  // Preview: Alt+V switches versions, F8 back to steps, F9 uses the prompt.
  await press('F9'); await flush()
  assert.ok($('[data-studio-preview]'))
  assertEverythingHasAKey()
  if ($('[data-studio-switch-version]')) {
    const heading = $('[data-studio-preview-title]').textContent
    await press('Alt+V')
    assert.notEqual($('[data-studio-preview-title]').textContent, heading)
  }
  await press('F9')
  assert.equal($('[data-studio-strip]'), null)
  // Closed studio: Alt+letters and F5–F10 belong to the app again.
  for (const combo of ['F5', 'F10', 'Alt+S', 'Alt+1']) assert.equal((await press(combo)).defaultPrevented, false, combo)
  // Ctrl/Super chords are never taken.
  await openStudio(INTENT, 'off')
  assert.equal((await press('F6', document.body, { ctrlKey: true })).defaultPrevented, false)
  assert.equal((await press('Alt+S', document.body, { metaKey: true })).defaultPrevented, false)
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
  await flush()
  assert.match($('[data-studio-cancel]').textContent, /^Cancelar/)
  assert.match($('[data-studio-shortcuts-help]').textContent, /^Atalhos/)
  ui.i18n.locale = 'en'
  await ui.act(async () => { ui.$locale.set('en') })
  await flush()
})

test('U1: focus lands on the first logical target after every step and status change, never the composer', { skip }, async () => {
  $('[data-slot="composer-rich-input"]').textContent = INTENT
  $('[data-slot="composer-rich-input"]').focus()
  await press('F4')
  await flush()
  assert.equal(active(), $('[data-studio-paste-open]'), 'paste step: "+ Paste text"')
  await press('Alt+C')
  assert.equal(active(), $('[data-studio-answer-input]'), 'paste field opened: textarea')
  await press('F10')
  await openStudio(INTENT, 'manual')
  await press('F6')
  assert.equal(active(), $('[data-studio-answer-input]'), 'text step: textarea')
  for (let i = 0; i < 10 && !$('[data-studio-options]'); i += 1) await press($('[data-studio-skip]') ? 'F6' : 'F5')
  assert.ok($('[data-studio-options]'))
  assert.equal(active(), $('[data-studio-recommend]') || $('[data-studio-option]'), 'choice step: recommended option')
  await press('Alt+S'); await flush()
  await press('Alt+D'); await flush()
  assert.ok(inStrip(), `after Discard focus stays in the studio (${active()?.tagName})`)
  await press('F9'); await flush()
  assert.equal(active(), $('[data-studio-use-prompt]'), 'preview: "Use this prompt"')
  await press('F8'); await flush()
  assert.ok(inStrip(), 'back to steps keeps focus in the studio')
})

test('U3/U7: F1 toggles a Shortcuts list with the full map and the left-Alt / number-row notes', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const help = $('[data-studio-shortcuts-help]')
  assert.equal(help.querySelector('[data-studio-key]')?.textContent, 'F1')
  assert.equal($('[data-studio-shortcuts-list]'), null)
  const event = await press('F1')
  assert.equal(event.defaultPrevented, true)
  const list = $('[data-studio-shortcuts-list]')
  assert.ok(list, 'F1 opened the list')
  for (const combo of ['F1', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'Alt+1…9', 'Alt+Shift+1…9', 'Alt+S', 'Alt+N', 'Alt+D', 'Alt+M', 'Alt+C', 'Alt+I', 'Alt+V']) {
    assert.ok(list.querySelector(`[data-studio-shortcut-row="${combo}"]`), `${combo} listed`)
  }
  assert.match(list.textContent, /left Alt/)
  assert.match(list.textContent, /physical number row/)
  assert.equal(help.getAttribute('aria-expanded'), 'true')
  await click('[data-studio-shortcuts-help]')
  assert.equal($('[data-studio-shortcuts-list]'), null, 'click closes it')
  await press('F10')
  assert.equal((await press('F1')).defaultPrevented, false, 'F1 is the app\'s while the studio is closed')
})

test('U4/U5/U13: key caps are the SDK Kbd; the primary cap is inverted with no opacity; reserved caps hold the width', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const primaryCap = $('[data-studio-skip] [data-studio-key]')
  assert.equal(primaryCap.tagName, 'KBD', 'SDK Kbd')
  assert.equal(primaryCap.getAttribute('data-kbd-variant'), 'inverted', 'own background from currentColor')
  assert.doesNotMatch(primaryCap.getAttribute('style') || '', /opacity/)
  await press('F6')
  const confirm = $('[data-studio-confirm]')
  assert.equal(confirm.disabled, true)
  const reserved = confirm.querySelector('[data-studio-key-reserved]')
  assert.ok(reserved, 'disabled Confirm keeps an invisible F5 cap')
  assert.match(reserved.getAttribute('style'), /visibility: hidden/)
  assert.equal(confirm.querySelector('[data-studio-key]'), null, 'no visible key on a disabled button')
})

test('U6: keys during IME composition are ignored', { skip }, async () => {
  await openStudio(INTENT, 'off')
  const field0 = field()
  const composing = await press('F6', document.body, { isComposing: true })
  assert.equal(field(), field0)
  assert.equal(composing.defaultPrevented, false)
  await press('F6', document.body, { keyCode: 229 })
  assert.equal(field(), field0, 'keyCode 229 ignored too')
})

test('U17: while open, F5-F10 are swallowed even with no control for them; Esc/Tab/Enter are never taken (U2 declined)', { skip }, async () => {
  await openStudio(INTENT, 'off')
  assert.equal(field(), 'thirdPartyText')
  assert.equal($('[data-studio-shortcut="F5"]'), null, 'no F5 control on the paste step')
  assert.equal((await press('F5')).defaultPrevented, true)
  for (const key of ['Escape', 'Tab', 'Enter']) assert.equal((await press(key)).defaultPrevented, false, key)
  assert.equal(field(), 'thirdPartyText', 'nothing ran')
})

test('U9: failures read as plain words; the technical detail is only in the tooltip', { skip }, async () => {
  backend.suggest = () => { throw new TypeError("Cannot read properties of undefined (reading 'kind')") }
  backend.compose = () => { throw new TypeError("Cannot read properties of undefined (reading 'kind')") }
  await openStudio()
  await pasteStep('')
  await flush()
  const error = $('[data-studio-ai-error]')
  assert.doesNotMatch(error.textContent, /Cannot read|TypeError/)
  assert.match(error.getAttribute('title'), /Cannot read/)
  await click('[data-studio-generate]')
  await flush()
  const note = $('[data-studio-preview-note]')
  assert.doesNotMatch(note.textContent, /Cannot read|TypeError/)
  assert.match(note.textContent, /version without AI/)
  assert.match(note.getAttribute('title'), /Cannot read/)
  await click('[data-studio-cancel]')
  backend.suggest = () => { throw new Error('HTTP 405 Method Not Allowed') }
  await openStudio()
  await pasteStep('')
  await flush()
  assert.match($('[data-studio-ai-error]').textContent, /Restart Hermes Desktop/)
})

test('U10/U11/U12/U15: labelled region, small live status, labelled answer field, radiogroups, labelled "Another"', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await flush()
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
  assert.equal($('[data-studio-ai-toggle]').getAttribute('aria-keyshortcuts'), 'Alt+I', 'Alt+I belongs to the group')
  for (const b of document.querySelectorAll('[data-studio-ai-mode-option]')) assert.equal(b.hasAttribute('aria-keyshortcuts'), false)
  const another = $('[data-studio-ai-retry]')
  assert.equal(another.getAttribute('aria-label'), 'Ask for another suggestion')
  assert.match(another.textContent, /Another/)
})

test('U14: the done state names the real Generate label and its key', { skip }, async () => {
  await openStudio(INTENT, 'off')
  for (let i = 0; i < 20 && $('[data-studio-step]'); i += 1) await press($('[data-studio-skip]') ? 'F6' : 'F5')
  assert.match(currentText(), /^All steps answered\. Choose “Generate prompt” \(F9\)\.$/)
  assert.doesNotMatch(currentText(), /Click/)
})

test('visual rules: no pill buttons, no italic, no monospace labels, no cream backgrounds', { skip }, async () => {
  await openStudio()
  await pasteStep('')
  await flush()
  await press('F1')
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
  await flush()
  return local
}
const optionLabels = () => [...document.querySelectorAll('[data-studio-option]')].map(el => el.getAttribute('data-studio-option'))

test('Auto, choice step: while the AI loads no option is recommended; the local pick is a plain option with its Alt key', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('auto')
  assert.ok(pending.length >= 1, 'AI asked automatically')
  assert.ok($('[data-studio-ai-loading]'), 'AI row loading')
  assert.equal(recommends().length, 0, 'no recommended button while loading')
  assert.equal(stars().length, 0, 'no star while loading')
  assert.ok(optionLabels().includes(local), 'local pick listed as a normal option')
  assert.match($(`[data-studio-option="${local}"] [data-studio-key]`).textContent, /^Alt\+\d$/)
  assertEverythingHasAKey()
  pending.at(-1).resolve({ ok: true, value: local, reason: 'x' })
  await flush()
})

test('Auto, choice step: the AI pick is the single recommended button (F5); no F7; AI agreeing gives one button too', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('auto')
  const other = optionLabels().find(o => o !== local)
  pending.at(-1).resolve({ ok: true, value: other, reason: 'porque sim' })
  await flush()
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1, 'exactly one star')
  assert.equal(primaries().length, 1, 'exactly one primary')
  assert.match(recommends()[0].textContent, new RegExp(`★ Recommended by AI: ${other}`))
  assert.equal(recommends()[0].querySelector('[data-studio-key]').textContent, 'F5')
  assert.equal($('[data-studio-ai-use]'), null, 'no separate Use suggestion (F7) on a choice step')
  assert.ok(optionLabels().includes(local) && !optionLabels().includes(other), 'local pick neutral, AI pick not duplicated')
  assert.match($('[data-studio-ai-row]').textContent, /Why: porque sim/)
  assert.ok($('[data-studio-ai-discard]') && $('[data-studio-ai-retry]'))
  assertEverythingHasAKey()
  // Another -> the AI agrees with the local pick: still one button.
  await click('[data-studio-ai-retry]')
  assert.equal(recommends().length, 0, 'neutral again while reloading')
  pending.at(-1).resolve({ ok: true, value: local, agrees: true, reason: 'ok' })
  await flush()
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`Recommended by AI: ${local}`))
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press('F5')
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, n + 1)
  assert.match([...document.querySelectorAll('[data-studio-rung]')].at(-1).textContent, new RegExp(local))
})

test('Auto, choice step: AI failure or Discard brings back the local recommendation as the single F5', { skip }, async () => {
  const pending = holdSuggest()
  const local = await toEnumStep('auto')
  pending.at(-1).reject(new Error('HTTP 502 upstream'))
  await flush()
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
  assert.equal(pending.length, 0, 'no automatic call')
  assert.equal(recommends().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`^★ Recommended: ${local}`))
  await click('[data-studio-ai-suggest]')
  const other = optionLabels().find(o => o !== local)
  pending.at(-1).resolve({ ok: true, value: other, reason: 'r' })
  await flush()
  assert.equal(recommends().length, 1)
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, new RegExp(`Recommended by AI: ${other}`))
  assert.equal($('[data-studio-ai-use]'), null)
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
  await flush()
  assert.equal(recommends().length, 1)
  assert.equal(primaries().length, 1, 'one primary')
  assert.equal(stars().length, 1)
  assert.match(recommends()[0].textContent, /Use AI suggestion/)
  assert.equal(recommends()[0].querySelector('[data-studio-key]').textContent, 'F5')
  assert.match($('[data-studio-use-default]').textContent, /Use: recommended list/)
  assertEverythingHasAKey()
  const n = document.querySelectorAll('[data-studio-rung]').length
  await press('F5')
  assert.equal(document.querySelectorAll('[data-studio-rung]').length, n + 1)
  assert.match([...document.querySelectorAll('[data-studio-rung]')].at(-1).textContent, /IA: evitar designAvoid/)
})

test('Auto walk: never more than one recommended button or star on screen at any time', { skip }, async () => {
  backend.suggest = body => ({ ok: true, value: body.field.kind === 'enum' ? body.field.options.at(-1) : '', reason: 'r' })
  await openStudio(INTENT, 'auto')
  await pasteStep('')
  for (let i = 0; i < 14 && field(); i += 1) {
    await flush()
    assert.ok(recommends().length <= 1, `at most one recommend on "${currentText()}"`)
    assert.ok(stars().length <= 1, `at most one star on "${currentText()}"`)
    assert.ok(primaries().length <= 1, `at most one primary on "${currentText()}"`)
    assertEverythingHasAKey()
    await answerStep()
  }
})
