// Ticket #29: draft detection lives in one module (rules as data); each engine is a profile that holds only its own
// rule lines and imports nothing but that module.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DETECTION } from '../../desktop/src/detection-core.js'
import { ENGINE as OPUS } from '../../desktop/src/engine-opus.js'
import { ENGINE as SONNET } from '../../desktop/src/engine-sonnet.js'
import { ENGINE as ASTRA } from '../../desktop/src/engine-astra.js'

const src = name => readFile(new URL(`../../desktop/src/${name}`, import.meta.url), 'utf8')
const ENGINE_FILES = ['engine-opus.js', 'engine-sonnet.js', 'engine-astra.js']
const importLines = source => source.split('\n').filter(line => /^\s*import\b/.test(line))

test('the detection core imports nothing and exposes the detector factory, fold and the make-verb rule', async () => {
  assert.deepEqual(importLines(await src('detection-core.js')), [])
  assert.equal(typeof DETECTION.createDetector, 'function')
  assert.equal(typeof DETECTION.fold, 'function')
  assert.ok(DETECTION.MAKE_VERB instanceof RegExp)
})

test('every engine imports only the detection core, as { DETECTION }', async () => {
  for (const file of ENGINE_FILES) {
    assert.deepEqual(importLines(await src(file)), ["import { DETECTION } from './detection-core.js'"], file)
  }
})

// The recognition constants that used to be copied into each engine (and kept equal by a parity test).
const SHARED = ['MAKE_VERB', 'CODE_ARTIFACT', 'TEXT_ARTIFACT', 'GENERATE_VERB', 'QUESTION_FORM', 'UNMARKED_YESNO', 'YESNO_FORM', 'EXPLAIN_FORM', 'QUESTION_START', 'NOUN_SIGNAL',
  'SENTENCE_START', 'VERB_OBJECT', 'REQUESTED_NOUN', 'COPULA', 'VERB_COPULA', 'PREDICATE', 'INFINITIVE_MARK', 'NEGATED', 'COORDINATED', 'LIST_TAIL', 'CLAUSE_NEGATION',
  'PREDICATE_NEGATION', 'QUESTION_HEAD', 'PRIOR_REQUEST', 'PRONOUN_OBJECT', 'REQUESTED_ARTIFACT', 'TOPIC_TAIL', 'TOPIC_AGENT', 'TOPIC_HEAD', 'ADDRESSED', 'RESPONSE_NOTE',
  'ORDER_LEAD', 'ORDER_JOIN', 'INTRO_CLAUSE', 'STATED_GOAL', 'MODIFIER_USE', 'COMPOUND_AFTER', 'NARRATIVE', 'MODIFIER_GAP', 'ROLE_HEAD', 'DECLARATIVE',
  'REVIEW_OBJECT', 'PLAN_OBJECT', 'DATA_OBJECT', 'WORKFLOW_OBJECT', 'CONTEXT_WINDOW', 'PT_INFINITIVE', 'AFTER_A']
const FUNCTIONS = ['firstSignal', 'isQuestion', 'questionAt', 'questionStart', 'pickArtifact', 'prohibited', 'contextBefore', 'coordinatedOrder', 'orderAfterSentence']

test('a recognition rule is written once: no engine declares a detection constant or function, the core does', async () => {
  const core = await src('detection-core.js')
  for (const name of SHARED) {
    assert.ok(new RegExp(`^\\s*const ${name} =`, 'm').test(core), `the core declares ${name}`)
  }
  for (const name of FUNCTIONS) assert.ok(new RegExp(`function ${name}\\(`).test(core), `the core declares ${name}()`)
  for (const file of ENGINE_FILES) {
    const source = await src(file)
    for (const name of SHARED) assert.ok(!new RegExp(`^\\s*const ${name}\\b`, 'm').test(source), `${file} must not declare ${name}`)
    for (const name of FUNCTIONS) assert.ok(!new RegExp(`function ${name}\\(`).test(source), `${file} must not declare ${name}()`)
  }
})

test('Opus and Sonnet carry no detection profile of their own: both read the core default, so they cannot drift', async () => {
  for (const file of ['engine-opus.js', 'engine-sonnet.js']) {
    const source = await src(file)
    assert.ok(!/^const (?:CATEGORY_RULES|DELIVERABLE_RULES|DATA_NOUN) =/m.test(source), file)
    assert.ok(/DETECTION\.createDetector\(\)/.test(source), `${file} uses the default profile`)
  }
  assert.ok(/DETECTION\.createDetector\(\{/.test(await src('engine-astra.js')), 'Astra passes its own rule lines')
})

test('rules are data: a profile with its own verb list classifies by it, the default list does not know the word', () => {
  const custom = DETECTION.createDetector({ verbs: [['plan', /\b(scheme)\b/]], categories: [] })
  assert.equal(custom.detect('Scheme the launch', '').signal, 'plan')
  assert.equal(custom.detect('Scheme the launch', '').category, 'general')
  const standard = DETECTION.createDetector()
  assert.equal(standard.detect('Scheme the launch', '').signal, null)
  // The shared object rules still apply under a custom list.
  assert.equal(custom.detect('Write a review of the API', '').signal, 'review')
})

test('detect: signal, category, folded text and goal; asksQuestion tells a question-shaped goal with no verb', () => {
  const detector = DETECTION.createDetector()
  const build = detector.detect('Build a React dashboard', 'use TypeScript')
  assert.equal(build.signal, 'implementation')
  assert.equal(build.category, 'code')
  assert.equal(build.text, 'build a react dashboard\nuse typescript')
  assert.equal(build.goal, 'build a react dashboard')
  assert.equal(build.asksQuestion, false)
  const open = detector.detect('Do cats sleep', '')
  assert.equal(open.signal, null)
  assert.equal(open.asksQuestion, true)
  assert.equal(detector.detect('Me ajuda com o projeto da empresa', '').asksQuestion, false)
})

test('fold: lower-cased, accents stripped, capped at 4000 characters unless the profile lifts the cap', () => {
  assert.equal(DETECTION.fold('ÁÉÍ Ção'), 'aei cao')
  assert.equal(DETECTION.fold('a'.repeat(5000)).length, 4000)
  assert.equal(DETECTION.fold('a'.repeat(5000), Infinity).length, 5000)
  const capped = DETECTION.createDetector()
  const open = DETECTION.createDetector({ foldLimit: Infinity })
  const long = `${'x '.repeat(2100)}Build a React dashboard`
  assert.equal(capped.detect(long, '').signal, null, 'the default cap hides a verb past 4000 characters')
  assert.equal(open.detect(long, '').signal, 'implementation', 'a profile may lift the cap')
})

test('engine profiles: Opus and Sonnet read the default rules; Astra keeps its own verb order and data rule', () => {
  for (const engine of [OPUS, SONNET, ASTRA]) {
    assert.equal(engine.analyze({ goal: 'Create a plan for the product launch' }).deliverable, 'plan')
    assert.equal(engine.analyze({ goal: 'Como funciona o cron do Linux?' }).deliverable, 'answer')
  }
  // Astra's own verb list: "levante" is an analysis verb there only.
  assert.equal(ASTRA.analyze({ goal: 'Levante os riscos do projeto' }).deliverable, 'analysis')
  assert.notEqual(OPUS.analyze({ goal: 'Levante os riscos do projeto' }).deliverable, 'analysis')
  // Astra's data rule: research on a spreadsheet stays analysis; the default rule says data.
  assert.equal(ASTRA.analyze({ goal: 'Pesquise e compare a planilha de vendas com o mercado' }).deliverable, 'analysis')
  assert.equal(OPUS.analyze({ goal: 'Pesquise e compare a planilha de vendas com o mercado' }).deliverable, 'data')
})
