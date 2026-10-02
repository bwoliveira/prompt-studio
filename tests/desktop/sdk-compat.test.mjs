// SDK compatibility across the supported Hermes range (plugin.yaml requires_hermes).
//
// Hermes Desktop loads desktop/plugin.js through a blob shim that re-exports only the names its SDK
// has; a static named import of any other name is a link error that kills the whole plugin (the
// "does not provide an export named 'ListRow'" bug on 0.21.4). So every name plugin.js imports by
// name from '@hermes/plugin-sdk' must exist in the SDK of every supported release. The fixtures
// in tests/desktop/fixtures/ are the value exports of apps/desktop/src/sdk/index.ts at a release tag;
// see scripts/sdk-exports.mjs for how to regenerate them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const plugin = readFileSync(process.env.PROMPT_STUDIO_PLUGIN || join(repo, 'desktop', 'plugin.js'), 'utf8')
const fixtures = readdirSync(join(here, 'fixtures')).filter(f => /^hermes-sdk-exports-[\d.]+\.txt$/.test(f))

function namedSdkImports(source) {
  const names = []
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@hermes\/plugin-sdk['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) names.push(name)
    }
  }
  return names
}

test('fixtures cover the oldest supported Hermes (requires_hermes) and the older 0.20.0 and 0.21.4 Desktops', () => {
  const min = readFileSync(join(repo, 'plugin.yaml'), 'utf8').match(/requires_hermes:\s*"?>=\s*([\d.]+)/)[1]
  assert.ok(fixtures.includes(`hermes-sdk-exports-${min}.txt`), `fixture for requires_hermes ${min}`)
  // Older Desktops must still load the plugin, so it can tell the user to update Hermes.
  assert.ok(fixtures.includes('hermes-sdk-exports-0.20.0.txt') && fixtures.includes('hermes-sdk-exports-0.21.4.txt'))
})

for (const file of fixtures) {
  test(`every named '@hermes/plugin-sdk' import in plugin.js exists in the ${file.slice(19, -4)} SDK`, () => {
    const exported = new Set(readFileSync(join(here, 'fixtures', file), 'utf8').split('\n').filter(l => l && !l.startsWith('#')))
    const imported = namedSdkImports(plugin)
    assert.ok(imported.length > 10, 'parsed the named import list')
    assert.deepEqual(imported.filter(name => !exported.has(name)), [])
  })
}
