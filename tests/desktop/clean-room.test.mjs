// Clean-room guard: the engines in desktop/src were written from the official vendor docs only.
// No 8-word run of the third-party prompt-builder sites' engines may appear in them, unless the same
// run is in the official docs (quoting the vendor is allowed). Those engines are read from a local
// checkout next to this repo (PROMPT_BUILDERS_DIR, default ../prompt-builders/<site>/engine.mjs) so
// their text is never stored here; the test is skipped when they or the docs snapshots are missing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const buildersDir = process.env.PROMPT_BUILDERS_DIR || join(repo, '..', 'prompt-builders')
const docsDir = process.env.PROMPT_DOCS_DIR || join(buildersDir, 'official-docs')
const words = text => text.toLowerCase().match(/[a-z0-9']+/g) || []
const runs = list => new Set(list.slice(0, Math.max(0, list.length - 7)).map((_, i) => list.slice(i, i + 8).join(' ')))

function oldEngines() {
  const files = ['opus-builder', 'astra-builder'].map(site => join(buildersDir, site, 'engine.mjs'))
  return files.every(existsSync) ? files.map(f => readFileSync(f, 'utf8')).join('\n') : null
}

function docsText(dir) {
  const out = []
  const walk = d => readdirSync(d).forEach(name => {
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else out.push(readFileSync(p, 'utf8'))
  })
  walk(dir)
  return ` ${words(out.join('\n')).join(' ')} `
}

const old = oldEngines()
const skip = !old ? 'prompt-builder site engines not available' : !existsSync(docsDir) ? 'official docs snapshots not available' : false

test('engines share no 8-word run with the removed site engines, except official-doc quotes', { skip }, () => {
  const oldRuns = runs(words(old))
  const docs = docsText(docsDir)
  for (const file of ['engine-opus.js', 'engine-astra.js']) {
    const hits = [...runs(words(readFileSync(join(repo, 'desktop', 'src', file), 'utf8')))]
      .filter(run => oldRuns.has(run) && !docs.includes(` ${run} `))
    assert.deepEqual(hits, [], `${file} repeats text from the removed site engines`)
  }
})
