// The target registry (desktop/src/studio-core.js): one entry per target model, read by the core, the UI target
// switch, the default-target rule, the design-avoid step and the build's engine list.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import * as core from '../../desktop/studio-core.mjs'
import { CORE_MESSAGES } from '../../desktop/src/i18n-core.js'

const { TARGETS, defaultTarget, fieldForTarget, questionFor } = core
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const BRIEF = 'Crie um dashboard web em React para acompanhar gastos mensais da casa'

// Per-target help/guide a registered target must have, in every locale: any field whose help or guide is an
// object keyed by target id needs a text for each registered id. Returns 'locale.field.help.id' for each gap.
function missingTargetText(targets, messages) {
  const gaps = []
  for (const [locale, bundle] of Object.entries(messages)) {
    for (const [field, text] of Object.entries(bundle.core.fields)) {
      for (const part of ['help', 'guide']) {
        const value = text[part]
        if (!value || typeof value !== 'object') continue
        for (const target of targets) if (typeof value[target.id] !== 'string') gaps.push(`${locale}.${field}.${part}.${target.id}`)
      }
    }
  }
  return gaps
}

test('every registry entry carries id, label, model, key, engine and capabilities', () => {
  assert.deepEqual(TARGETS.map(t => t.id), ['opus', 'astra', 'sonnet'])
  const keys = new Set()
  for (const target of TARGETS) {
    assert.ok(target.id && target.label, `${target.id}: id and label`)
    assert.match(target.key, /^Alt\+[A-Z]$/, `${target.id}: key`)
    assert.ok(!keys.has(target.key), `${target.id}: key is unique`)
    keys.add(target.key)
    assert.equal(typeof target.engine?.build, 'function', `${target.id}: engine`)
    assert.equal(target.model, target.engine.model, `${target.id}: model comes from the engine`)
    assert.equal(typeof target.capabilities, 'object', `${target.id}: capabilities`)
  }
  assert.equal(TARGETS.filter(t => t.pattern === null).length, 1, 'exactly one fallback target without a pattern')
})

test('a registered target without its i18n help and guide entries is reported', () => {
  assert.deepEqual(missingTargetText(TARGETS, CORE_MESSAGES), [], 'every registered target has its help and guide in en and pt')
  assert.ok(typeof CORE_MESSAGES.en.core.fields.autonomy.help === 'object' && typeof CORE_MESSAGES.pt.core.fields.autonomy.guide === 'object', 'the check is not vacuous')
  assert.deepEqual(
    missingTargetText([...TARGETS, { id: 'ghost' }], CORE_MESSAGES).sort(),
    ['en.autonomy.guide.ghost', 'en.autonomy.help.ghost', 'pt.autonomy.guide.ghost', 'pt.autonomy.help.ghost']
  )
  const { sonnet, ...helpWithoutSonnet } = CORE_MESSAGES.pt.core.fields.autonomy.help
  const partial = { pt: { core: { fields: { autonomy: { ...CORE_MESSAGES.pt.core.fields.autonomy, help: helpWithoutSonnet } } } } }
  assert.ok(typeof sonnet === 'string')
  assert.deepEqual(missingTargetText(TARGETS, partial), ['pt.autonomy.help.sonnet'])
})

test('default target: the registry patterns decide, the fallback target takes the rest', () => {
  const cases = {
    'gpt-6-astra': 'astra', 'openai/gpt-5': 'astra', 'o3': 'astra', 'codex-mini': 'astra',
    'claude-sonnet-5-5': 'sonnet', 'anthropic/Claude Sonnet 5.5': 'sonnet', 'openai/claude-sonnet-5-5': 'sonnet',
    'claude-opus-5-5': 'opus', 'claude-haiku-4': 'opus', 'gemini-3-pro': 'opus', 'deepseek-v4': 'opus', '': 'opus'
  }
  for (const [model, expected] of Object.entries(cases)) assert.equal(defaultTarget(model), expected, model)
  assert.equal(defaultTarget(undefined), 'opus')
  assert.equal(defaultTarget(null), 'opus')
})

test('design-avoid applies to the targets whose capabilities say so, and to no unknown target', () => {
  for (const target of TARGETS) assert.equal(fieldForTarget('designAvoid', target.id), Boolean(target.capabilities.designAvoid), target.id)
  assert.deepEqual(TARGETS.filter(t => t.capabilities.designAvoid).map(t => t.id), ['opus', 'sonnet'])
  assert.equal(fieldForTarget('designAvoid', 'nobody'), false)
})

test('the question names the target by its registry label', () => {
  for (const target of TARGETS) assert.equal(questionFor(target.id, BRIEF, [], 'autonomy', 'en').question, `How much autonomy should ${target.label} have?`)
  assert.equal(questionFor('nobody', BRIEF, [], 'autonomy', 'en').question, `How much autonomy should ${TARGETS[0].label} have?`)
})

test('no second table of target ids, names or keys outside the registry', async () => {
  const code = text => text.split('\n').filter(line => !/^\s*\/\//.test(line))
  const idLines = code(await read('desktop/src/studio-core.js')).filter(line => /['"](opus|astra|sonnet)['"]/.test(line))
  assert.equal(idLines.length, TARGETS.length, 'target ids appear only on the registry entries')
  assert.ok(idLines.every(line => /^\s*\{ id: /.test(line)), idLines.join('\n'))
  assert.doesNotMatch(await read('desktop/src/studio-core.js'), /TARGET_NAME|STUDIO_ENGINES/)
  // The hand-written UI is split into desktop/src/ui-*.js: none of them may hold a second table.
  const uiFiles = (await readdir(new URL('../../desktop/src', import.meta.url))).filter(name => /^ui-.*\.js$/.test(name))
  assert.ok(uiFiles.includes('ui-keys.js') && uiFiles.includes('ui-steps.js'), uiFiles.join())
  const ui = (await Promise.all(uiFiles.map(name => read(`desktop/src/${name}`)))).join('\n')
  assert.doesNotMatch(ui, /['"](opus|astra|sonnet)['"]/)
  assert.doesNotMatch(ui, /Alt\+[OAT]['"]/)
})
