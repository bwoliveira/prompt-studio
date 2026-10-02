// Declared dev dependencies (package.json + package-lock.json) and the "no silent skip" rule of `npm test`:
// the UI tests must run from the repo's own node_modules, so a missing dependency fails the run instead of
// skipping the UI tests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const REQUIRED = ['react', 'react-dom', 'jsdom', 'nanostores', '@nanostores/react', 'esbuild', 'acorn']

test('package.json pins every UI-test dependency to an exact version', () => {
  assert.equal(pkg.private, true, 'never published')
  for (const name of REQUIRED) {
    assert.match(pkg.devDependencies?.[name] ?? '', /^\d+\.\d+\.\d+$/, `${name} is pinned exactly (no ^ or ~)`)
  }
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), [...REQUIRED].sort(), 'nothing else is declared')
  assert.equal(pkg.dependencies, undefined, 'the plugin ships no runtime npm packages')
})

test('package-lock.json is committed and agrees with package.json', () => {
  const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
  assert.ok(lock.lockfileVersion >= 3)
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} in the lockfile`)
    assert.equal(lock.packages[''].devDependencies[name], version, `${name} in the lockfile root`)
  }
})

test('npm test fails when a dependency is missing instead of skipping the UI tests, and runs under a memory limit', () => {
  assert.match(pkg.scripts.test, /PROMPT_STUDIO_REQUIRE_DEPS=1/, 'npm test sets the no-skip switch')
  assert.match(pkg.scripts.test, /node --test tests\/desktop\/\*\.test\.mjs/)
  assert.match(pkg.scripts.test, /--max-old-space-size=\d+/, 'node own heap limit, the CI counterpart of the local systemd cap')
  // The real file with no usable node_modules anywhere, CI unset: it must fail loudly, naming the packages.
  const empty = mkdtempSync(join(tmpdir(), 'ps-nomods-'))
  try {
    const env = { ...process.env, PROMPT_STUDIO_NODE_MODULES: empty, PROMPT_STUDIO_NODE_MODULES_ONLY: '1', PROMPT_STUDIO_REQUIRE_DEPS: '1' }
    delete env.CI
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ['--test', join(repo, 'tests/desktop/studio-flow.test.mjs')], { env, encoding: 'utf8', timeout: 60_000 })
    const out = `${run.stdout}\n${run.stderr}`
    assert.notEqual(run.status, 0, out.slice(-2000))
    assert.match(out, /UI tests need react, react-dom, jsdom/, out.slice(-2000))
    assert.doesNotMatch(out, /SKIPPING UI tests/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('without the switch (a plain local `node --test`) the missing dependencies still skip, with the reason printed', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ps-nomods-'))
  try {
    const env = { ...process.env, PROMPT_STUDIO_NODE_MODULES: empty, PROMPT_STUDIO_NODE_MODULES_ONLY: '1' }
    for (const key of ['CI', 'PROMPT_STUDIO_REQUIRE_DEPS', 'NODE_TEST_CONTEXT']) delete env[key]
    const run = spawnSync(process.execPath, ['--test', join(repo, 'tests/desktop/studio-flow.test.mjs')], { env, encoding: 'utf8', timeout: 60_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.slice(-2000))
    assert.match(`${run.stdout}\n${run.stderr}`, /SKIPPING UI tests/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('node_modules stays out of git and the dependencies are resolved from it', () => {
  assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /^node_modules\/$/m)
  assert.ok(existsSync(join(repo, 'package-lock.json')))
})
