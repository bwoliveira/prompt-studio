// One prompt snapshot per target, built from the same fixed brief (fixtures/prompt-snapshots/brief.json).
// The expected prompts are plain text files next to the brief, so a change to a rule line shows up as a
// readable diff in review. After an intended change: UPDATE_SNAPSHOTS=1 node --test tests/desktop/prompt-snapshots.test.mjs
// rewrites them; read the git diff before committing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { ENGINE as OPUS } from '../../desktop/src/engine-opus.js'
import { ENGINE as SONNET } from '../../desktop/src/engine-sonnet.js'
import { ENGINE as ASTRA } from '../../desktop/src/engine-astra.js'

const DIR = new URL('./fixtures/prompt-snapshots/', import.meta.url)
const BRIEF = JSON.parse(readFileSync(new URL('brief.json', DIR), 'utf8'))

for (const [name, engine] of [['opus', OPUS], ['sonnet', SONNET], ['astra', ASTRA]]) {
  test(`prompt snapshot: ${name} for the fixed brief`, () => {
    const file = new URL(`${name}.txt`, DIR)
    const { prompt } = engine.build(BRIEF)
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(file, prompt + '\n')
    assert.ok(existsSync(file), `missing snapshot ${name}.txt (UPDATE_SNAPSHOTS=1 writes it)`)
    assert.ok(readFileSync(file, 'utf8') === prompt + '\n', `${name} prompt differs from fixtures/prompt-snapshots/${name}.txt; git diff after UPDATE_SNAPSHOTS=1 shows how`)
  })
}
