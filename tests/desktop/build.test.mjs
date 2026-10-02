// scripts/build.mjs helpers: top-level name detection, export stripping, collision checks and the --check output
// comparison. The CLI tests run a copy of the build in a temp dir so the real desktop/plugin.js is never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm, unlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareOutputs, findCollisions, stripExports, stripImports, topLevelNames } from '../../scripts/build.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const names = source => [...topLevelNames(source)].sort()

test('topLevelNames: plain declarations, with and without export', () => {
  const source = [
    'const a = 1', 'export let b = 2', 'var c', 'class D {}', 'export class E {}', 'function f() {}',
    'export async function g() {}', 'async function h() {}', 'function* gen() {}', 'export function* gen2() {}'
  ].join('\n')
  assert.deepEqual(names(source), ['D', 'E', 'a', 'b', 'c', 'f', 'g', 'gen', 'gen2', 'h'])
})

test('topLevelNames: object and array destructuring', () => {
  assert.deepEqual(names('const {a, b} = obj'), ['a', 'b'])
  assert.deepEqual(names('export const {a, b: renamed, c = 1, ...rest} = obj'), ['a', 'c', 'renamed', 'rest'])
  assert.deepEqual(names('const [p, , q = 2, ...others] = list'), ['others', 'p', 'q'])
  assert.deepEqual(names('const {a: {b, c: [d, e]}} = deep'), ['b', 'd', 'e'])
})

test('topLevelNames: several declarators in one statement', () => {
  assert.deepEqual(names('let a, b'), ['a', 'b'])
  assert.deepEqual(names('let a = 1, b = [1, 2, 3], c'), ['a', 'b', 'c'])
  assert.deepEqual(names('const f = (x, y) => x + y, g = {k: 1, l: 2}'), ['f', 'g'])
  assert.deepEqual(names("const s = 'a, b', t = `c, ${d}`, u = 3"), ['s', 't', 'u'])
  assert.deepEqual(names('export let x, y = 2'), ['x', 'y'])
})

test('topLevelNames: multi-line declarations', () => {
  const source = [
    'const config = {',
    '  retries: 3,',
    '  names: [1, 2]',
    '},',
    '  other = 2,',
    '  third',
    'const next = 1'
  ].join('\n')
  assert.deepEqual(names(source), ['config', 'next', 'other', 'third'])
  assert.deepEqual(names('const {\n  a,\n  b: c,\n} = obj\nlet z'), ['a', 'c', 'z'])
  assert.deepEqual(names('const total = first +\n  second,\n  after = 1'), ['after', 'total'])
  assert.deepEqual(names('const fn = () =>\n  value\nconst other = 1'), ['fn', 'other'])
})

test('topLevelNames: ignores indented code, comments, export lists and reads imports', () => {
  const source = [
    "import React, { useState as useS, useEffect } from 'react'",
    "import * as ns from 'x'",
    'function f() {',
    '  const inner = 1',
    '}',
    '// const commented = 1',
    'export { f, other }',
    'export {',
    '  alpha,',
    '  beta as gamma',
    '}'
  ].join('\n')
  assert.deepEqual(names(source), ['React', 'f', 'ns', 'useEffect', 'useS'])
})

test('stripExports: keeps declarations, drops export lists and default markers', () => {
  const source = ['export const a = 1', 'export async function b() {}', 'export {a,b}', 'export {', '  a,', '  b as c', '}', 'export default function d() {}', 'const keep = 1'].join('\n')
  const out = stripExports(source)
  assert.ok(!/\bexport\b/.test(out), out)
  assert.ok(/^const a = 1$/m.test(out) && /^async function b\(\) \{\}$/m.test(out) && /^function d\(\) \{\}$/m.test(out) && /^const keep = 1$/m.test(out))
  assert.ok(!/^\s*(a,|b as c)\s*$/m.test(out), out)
})

test('stripExports: fails clearly on forms it cannot inline', () => {
  assert.throws(() => stripExports("export * from './x.js'"), /re-export/)
  assert.throws(() => stripExports("export { a } from './x.js'"), /re-export/)
  assert.throws(() => stripExports('export default {a: 1}'), /export default/)
})

test('stripImports removes import lines only', () => {
  assert.equal(stripImports("import a from 'a'\nconst b = 1\n"), 'const b = 1\n')
})

test('findCollisions: passes when every name is unique across all entries', () => {
  assert.doesNotThrow(() => findCollisions([['head', 'const a = 1'], ['ui-a.js', 'const b = 1'], ['ui-b.js', 'const {c, d} = x']]))
})

test('findCollisions: a name declared in two UI files is reported with both files', () => {
  assert.throws(() => findCollisions([['plugin-head.js', 'const h = 1'], ['ui-a.js', 'const dup = 1'], ['ui-b.js', 'function dup() {}']]), /name collision: dup declared by both ui-a\.js and ui-b\.js/)
})

test('findCollisions: collisions through destructuring and multi-declarator forms are found', () => {
  assert.throws(() => findCollisions([['ui-a.js', 'const {x, y} = o'], ['ui-b.js', 'let q, y']]), /collision: y/)
  assert.throws(() => findCollisions([['head', 'import { useState } from "react"'], ['ui-a.js', 'let a, useState']]), /collision: useState/)
})

test('compareOutputs: reports missing outputs apart from stale ones', () => {
  const expected = { 'desktop/plugin.js': 'A', 'desktop/studio-core.mjs': 'B' }
  assert.deepEqual(compareOutputs(expected, { 'desktop/plugin.js': 'A', 'desktop/studio-core.mjs': 'B' }), { missing: [], stale: [] })
  assert.deepEqual(compareOutputs(expected, { 'desktop/plugin.js': null, 'desktop/studio-core.mjs': 'old' }), { missing: ['desktop/plugin.js'], stale: ['desktop/studio-core.mjs'] })
  assert.deepEqual(compareOutputs(expected, { 'desktop/plugin.js': 'x', 'desktop/studio-core.mjs': 'B' }), { missing: [], stale: ['desktop/plugin.js'] })
})

async function buildCopy() {
  const dir = await mkdtemp(join(tmpdir(), 'ps-build-'))
  await mkdir(join(dir, 'scripts'))
  await mkdir(join(dir, 'desktop'))
  await cp(join(repo, 'scripts/build.mjs'), join(dir, 'scripts/build.mjs'))
  await cp(join(repo, 'desktop/src'), join(dir, 'desktop/src'), { recursive: true })
  return dir
}
const run = (dir, ...args) => spawnSync(process.execPath, ['scripts/build.mjs', ...args], { cwd: dir, encoding: 'utf8' })

test('CLI --check: missing desktop/plugin.js is a clear error, not "stale"', async () => {
  const dir = await buildCopy()
  try {
    assert.equal(run(dir).status, 0)
    assert.equal(run(dir, '--check').status, 0)
    await unlink(join(dir, 'desktop/plugin.js'))
    const missing = run(dir, '--check')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /missing build output: desktop\/plugin\.js/)
    assert.match(missing.stderr, /node scripts\/build\.mjs/)
    assert.doesNotMatch(missing.stderr, /stale/)
    await writeFile(join(dir, 'desktop/plugin.js'), '// edited\n')
    const stale = run(dir, '--check')
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /stale build output: desktop\/plugin\.js/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI: a name declared in two UI files fails the build', async () => {
  const dir = await buildCopy()
  try {
    await writeFile(join(dir, 'desktop/src/ui-prefs.js'), 'const uiFlowTwin = 1\n', { flag: 'a' })
    await writeFile(join(dir, 'desktop/src/ui-flow.js'), 'const uiFlowTwin = 2\n', { flag: 'a' })
    const result = run(dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /name collision: uiFlowTwin declared by both ui-prefs\.js and ui-flow\.js/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the repository build output is up to date', () => {
  const result = run(repo, '--check')
  assert.equal(result.status, 0, result.stderr)
})
