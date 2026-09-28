import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'

// The studio state machine lives between `// @core-start` and `// @core-end` in desktop/plugin.js
// (the file Desktop loads). Import that exact block, so no generated copy can drift from it.
const plugin = await readFile(new URL('../../desktop/plugin.js', import.meta.url), 'utf8')
const coreSource = plugin.slice(plugin.indexOf('// @core-start'), plugin.indexOf('// @core-end'))
const dir = await mkdtemp(join(tmpdir(), 'flow-core-'))
await writeFile(join(dir, 'core.mjs'), coreSource)
const { initialStudioState, reduceStudio } = await import(pathToFileURL(join(dir, 'core.mjs')).href)
after(() => rm(dir, { recursive: true, force: true }))

const Q = (question, extra = {}) => ({ type: 'INTERROGATION', response: { question, category: question, recommended: 'rec', options: ['a', 'b'], ...extra } })

test('BRIEF_READY keeps the technical note detail apart from the note', () => {
  const briefing = reduceStudio(reduceStudio(reduceStudio(initialStudioState(), { type: 'START', intent: 'x' }), { type: 'INTERROGATION', response: { done: true } }), { type: 'WRITE_BRIEF' })
  const ready = reduceStudio(briefing, { type: 'BRIEF_READY', engine: 'E', note: 'plain', noteDetail: 'TypeError: x' })
  assert.deepEqual([ready.preview.note, ready.preview.noteDetail], ['plain', 'TypeError: x'])
})

test('state machine: idle → asking → active → asking → done → briefing → preview', () => {
  let state = reduceStudio(initialStudioState(), { type: 'START', intent: 'Crie um app' })
  assert.equal(state.status, 'asking')
  state = reduceStudio(state, Q('context', { kind: 'text', help: 'h' }))
  assert.equal(state.status, 'active')
  assert.equal(state.current.kind, 'text')
  state = reduceStudio(state, { type: 'SET_ANSWER', answer: 'rascunho' })
  assert.equal(state.answer, 'rascunho')
  state = reduceStudio(state, { type: 'COMMIT_ANSWER', answer: 'resposta' })
  assert.equal(state.status, 'asking')
  assert.deepEqual(state.ladder.map(r => [r.category, r.answer]), [['context', 'resposta']])
  state = reduceStudio(state, { type: 'INTERROGATION', response: { done: true } })
  assert.equal(state.status, 'done')
  state = reduceStudio(state, { type: 'WRITE_BRIEF' })
  assert.equal(state.status, 'briefing')
  assert.equal(reduceStudio(state, { type: 'BRIEF_FAILED' }).status, 'done', 'a failed write returns to the steps, not a dead end')
  const preview = reduceStudio(state, { type: 'BRIEF_READY', ai: 'AI', engine: 'ENGINE', note: 'n' })
  assert.equal(preview.status, 'preview')
  assert.equal(preview.preview.showing, 'ai')
  assert.equal(reduceStudio(preview, { type: 'SHOW_VERSION', version: 'engine' }).preview.showing, 'engine')
  assert.equal(reduceStudio(preview, { type: 'BACK_TO_STEPS' }).status, 'done')
  const noAi = reduceStudio(state, { type: 'BRIEF_READY', ai: '', engine: 'ENGINE' })
  assert.equal(noAi.preview.showing, 'engine')
  assert.equal(reduceStudio(noAi, { type: 'SHOW_VERSION', version: 'ai' }), noAi, 'no empty AI version to switch to')
  assert.deepEqual(reduceStudio(state, { type: 'RESET' }), initialStudioState())
})

test('an empty commit takes the recommended value', () => {
  let state = reduceStudio(reduceStudio(initialStudioState(), { type: 'START', intent: 'x' }), Q('autonomy'))
  state = reduceStudio(state, { type: 'COMMIT_ANSWER', answer: '' })
  assert.equal(state.ladder[0].answer, 'rec')
})

test('WRITE_BRIEF mid-step commits only an explicit answer', () => {
  const active = reduceStudio(reduceStudio(initialStudioState(), { type: 'START', intent: 'x' }), Q('format'))
  const withAnswer = reduceStudio(active, { type: 'WRITE_BRIEF', answer: ' Lista ', includeCurrent: true })
  assert.deepEqual(withAnswer.ladder.map(r => r.answer), ['Lista'])
  const empty = reduceStudio(active, { type: 'WRITE_BRIEF', answer: '', includeCurrent: true })
  assert.deepEqual(empty.ladder, [], 'an unanswered step does not adopt the recommendation')
  assert.equal(empty.current, null)
})

test('actions outside their status are ignored', () => {
  const idle = initialStudioState()
  for (const action of [{ type: 'SET_ANSWER', answer: 'x' }, { type: 'COMMIT_ANSWER' }, Q('x'), { type: 'WRITE_BRIEF' }, { type: 'BRIEF_FAILED' }, { type: 'RETARGET', ladder: [] }, { type: 'UNKNOWN' }]) {
    assert.equal(reduceStudio(idle, action), idle, action.type)
  }
})

test('EDIT_STEP reopens one answered step in place and keeps the later answers', () => {
  let state = reduceStudio(initialStudioState(), { type: 'START', intent: 'x' })
  for (const step of ['a', 'b', 'c']) state = reduceStudio(reduceStudio(state, Q(step)), { type: 'COMMIT_ANSWER', answer: step.toUpperCase() })
  state = reduceStudio(state, { type: 'INTERROGATION', response: { done: true } })
  const editing = reduceStudio(state, { type: 'EDIT_STEP', index: 1 })
  assert.equal(editing.status, 'asking')
  assert.deepEqual(editing.ladder.map(r => r.answer), ['A', 'C'])
  assert.equal(editing.editing.rung.answer, 'B')
  // New answer goes back to its own place.
  const saved = reduceStudio(reduceStudio(editing, Q('b')), { type: 'COMMIT_ANSWER', answer: 'B2' })
  assert.deepEqual(saved.ladder.map(r => r.answer), ['A', 'B2', 'C'])
  assert.equal(saved.editing, null)
  // Undo keeps the original answer.
  const undone = reduceStudio(reduceStudio(editing, Q('b')), { type: 'CANCEL_EDIT' })
  assert.deepEqual(undone.ladder.map(r => r.answer), ['A', 'B', 'C'])
  // Generating mid-edit without a new answer keeps the original one too.
  const generated = reduceStudio(reduceStudio(editing, Q('b')), { type: 'WRITE_BRIEF', answer: '', includeCurrent: true })
  assert.deepEqual(generated.ladder.map(r => r.answer), ['A', 'B', 'C'])
  // Editing another step first puts the one being edited back.
  const switched = reduceStudio(reduceStudio(editing, Q('b')), { type: 'EDIT_STEP', index: 0 })
  assert.deepEqual(switched.ladder.map(r => r.answer), ['B', 'C'])
  assert.equal(switched.editing.rung.answer, 'A')
  assert.equal(reduceStudio(state, { type: 'EDIT_STEP', index: 9 }), state)
  assert.equal(reduceStudio({ ...state, status: 'briefing' }, { type: 'EDIT_STEP', index: 0 }).status, 'briefing')
})

test('RETARGET replaces the answered steps and asks again', () => {
  let state = reduceStudio(reduceStudio(initialStudioState(), { type: 'START', intent: 'x' }), Q('a'))
  state = reduceStudio(state, { type: 'RETARGET', ladder: [{ question: 'q', answer: 'kept', category: 'context', recommended: '' }] })
  assert.equal(state.status, 'asking')
  assert.equal(state.current, null)
  assert.deepEqual(state.ladder.map(r => r.answer), ['kept'])
})

test('composer only through host.composer (no app DOM, no attachment reach-in); only F-keys/Alt chords are bound, never Tab/Enter/Esc', () => {
  assert.doesNotMatch(plugin, /data-slot="composer|composerAttachments|__HERMES_PLUGIN_SDK__|forwardAttachments/)
  assert.match(plugin, /host\.composer\.getDraft\(null\)/)
  assert.match(plugin, /host\.composer\.setDraft\(null, text\)/)
  assert.equal((plugin.match(/addEventListener\((window, )?['"]key(down|up)/g) || []).length, 1, 'one listener (the studio keys)')
  assert.match(plugin, /ctx\.addEventListener\(window, 'keydown'/, 'tracked by the host')
  assert.doesNotMatch(plugin, /event\.key === ['"](Tab|Enter|Escape)/)
  assert.match(plugin, /const OPEN_KEY = 'F4'/)
})
