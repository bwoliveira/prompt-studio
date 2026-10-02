// The build derives its engine list from the imports of studio-core.js, the registry's own file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { studioEngines } from '../../scripts/build.mjs'

test('the build reads its engine list from the imports of studio-core.js', async () => {
  const engines = studioEngines(await readFile(new URL('../../desktop/src/studio-core.js', import.meta.url), 'utf8'))
  assert.deepEqual(engines.map(e => e.file), ['engine-opus.js', 'engine-astra.js', 'engine-sonnet.js'])
  assert.deepEqual(engines.map(e => e.name), ['OPUS_ENGINE', 'ASTRA_ENGINE', 'SONNET_ENGINE'])
  const next = studioEngines("import { ENGINE as OPUS_ENGINE } from './engine-opus.js'\nimport { ENGINE as NEW_ENGINE } from './engine-new.js'\nimport { CORE_MESSAGES } from './i18n-core.js'\n")
  assert.deepEqual(next, [{ file: 'engine-opus.js', name: 'OPUS_ENGINE' }, { file: 'engine-new.js', name: 'NEW_ENGINE' }])
  assert.throws(() => studioEngines("import { ENGINE } from './engine-odd.js'\n"), /engine-odd\.js/)
})

