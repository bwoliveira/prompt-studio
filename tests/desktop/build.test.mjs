// scripts/build.mjs helpers: top-level name detection, export stripping, collision checks and the --check output
// comparison. The CLI tests run a copy of the build in a temp dir so the real desktop/plugin.js is never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm, unlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidModule, compareOutputs, findCollisions, stripExports, stripImports, topLevelNames } from '../../scripts/build.mjs'

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

test('topLevelNames: a template literal with interpolation does not hide the next declarator or declaration', () => {
  assert.deepEqual(names("const a = `${'x'}`, hidden = 1"), ['a', 'hidden'])
  assert.deepEqual(names('const a = `${b}-${`n${c}`}`, hidden = 1\nconst after = 2'), ['a', 'after', 'hidden'])
  assert.deepEqual(names("const t = `${'x'}`\nconst following = 1"), ['following', 't'])
})

test('topLevelNames: declaration-looking lines inside a template literal or block comment are not names', () => {
  assert.deepEqual(names('const t = `\nconst fake = 1\nfunction ghost() {}\n`\nconst real = 2'), ['real', 't'])
  assert.deepEqual(names('/*\nconst fake = 1\n*/\nconst real = 2'), ['real'])
})

test('topLevelNames: comments between declarators do not hide a binding', () => {
  assert.deepEqual(names('const a = 1, /* why */ hidden = 2'), ['a', 'hidden'])
  assert.deepEqual(names('const a = 1, // why\n  hidden = 2'), ['a', 'hidden'])
  assert.deepEqual(names('const a = 1,\n  /* why\n  still */\n  hidden = 2\nlet z'), ['a', 'hidden', 'z'])
  assert.deepEqual(names('const /* c */ {x, y} = o'), ['x', 'y'])
})

test('findCollisions: a duplicate hidden behind a template literal or a comment is found', () => {
  assert.throws(() => findCollisions([['ui-a.js', "const a = `${'x'}`, hidden = 1"], ['ui-b.js', 'const hidden = 2']]), /collision: hidden declared by both ui-a\.js and ui-b\.js/)
  assert.throws(() => findCollisions([['ui-a.js', 'const a = 1, /* c */ hidden = 2'], ['ui-b.js', 'let hidden']]), /collision: hidden/)
})

test('assertValidModule: accepts a module and rejects a duplicate binding with the label', async () => {
  await assert.doesNotReject(assertValidModule('ok.js', "import x from 'x'\nconst a = 1\nexport { a, x }\n"))
  await assert.rejects(assertValidModule('desktop/plugin.js', 'const a = 1\n  const a = 2\n'), /desktop\/plugin\.js is not valid ESM[\s\S]*already been declared/)
  await assert.rejects(assertValidModule('broken.js', 'const = ;'), /broken\.js is not valid ESM/)
})

test('assertValidModule: never runs the module it checks, even one that imports only built-ins', async () => {
  delete globalThis.__psSyntaxRan
  await assert.doesNotReject(assertValidModule('side-effect.js', "import 'node:fs'\nglobalThis.__psSyntaxRan = true\nexport const z = 1\n"))
  await assert.doesNotReject(assertValidModule('plain.js', 'globalThis.__psSyntaxRan = true\n'))
  assert.equal(globalThis.__psSyntaxRan, undefined)
})

test('walk: a regex literal after return, typeof and the like is not a string (Codex P2)', () => {
  const source = "function matches(text) { return /'/.test(text) }\nfunction kind(x) { return typeof /\"/ }\nexport const ENGINE = { matches, kind }\n"
  const out = stripExports(source)
  assert.ok(/^const ENGINE = \{ matches, kind \}$/m.test(out), out)
  assert.ok(out.includes("return /'/.test(text)"), out)
  assert.deepEqual([...topLevelNames(source)].sort(), ['ENGINE', 'kind', 'matches'])
  assert.ok(stripExports('const half = total / 2\nexport const r = half / 3 / 4\n').includes('const r = half / 3 / 4'))
})

test('walk: a comment between the keyword and the regex literal does not turn it into a division (Codex P2)', () => {
  for (const source of [
    "export function matches(text) { return /* note */ /'/.test(text) }\nexport const ENGINE = { matches }\n",
    "export function matches(text) { return // note\n /'/.test(text) }\nexport const ENGINE = { matches }\n",
  ]) {
    const out = stripExports(source)
    assert.ok(!/^export\b/m.test(out), out)
    assert.ok(/^const ENGINE = \{ matches \}$/m.test(out), out)
  }
  // Near misses: division after a comment, and a property named like a keyword, stay divisions.
  assert.ok(stripExports("const half = total /* n */ / 2\nexport const r = half / 3 / 4\n").includes('const r = half / 3 / 4'))
  assert.ok(stripExports("const q = obj.in / 2 / 3\nexport const r = q / 4\n").includes('const r = q / 4'))
  assert.ok(stripExports("const q = obj.in / 2 + '/'\nexport const r = 1\n").includes('const r = 1'))
})

test('topLevelNames: astral characters (emoji) in a comment do not shift the masks after them (Codex P2)', () => {
  const source = `// ${'😀'.repeat(15)}\nconst real = \`\nconst fake = 1\n\`\n`
  assert.deepEqual([...topLevelNames(source)], ['real'])
  assert.doesNotThrow(() => findCollisions([['ui-a.js', source], ['ui-b.js', 'const fake = 2\n']]))
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

test('stripExports: text that looks like an export inside a template literal, string or comment is kept (Codex P2)', () => {
  const source = ['export const example = `', 'export { sample }', 'export const inner = 1', '`', "export const quoted = 'export { q }'", '/*', 'export { inComment }', '*/', 'export { example }', ''].join('\n')
  const out = stripExports(source)
  assert.ok(out.includes('`\nexport { sample }\nexport const inner = 1\n`'), out)
  assert.ok(out.includes("'export { q }'"), out)
  assert.ok(out.includes('/*\nexport { inComment }\n*/'), out)
  assert.ok(/^const example = `$/m.test(out) && /^const quoted = /m.test(out), out)
  assert.ok(!/^export \{ example \}$/m.test(out), out)
  assert.doesNotThrow(() => stripExports('const doc = `\nexport default {a: 1}\nexport * from \'./x.js\'\n`\n'))
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

test('CLI --check writes nothing and starts no process, so it works in the read-only review sandbox (Codex P2)', async () => {
  const dir = await buildCopy()
  try {
    assert.equal(run(dir).status, 0)
    // The sandbox: no writable temp folder, and every child process fails with EPERM.
    const deny = join(dir, 'deny-children.cjs')
    await writeFile(deny, [
      "const cp = require('node:child_process')",
      "for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[k] = () => { throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }) }",
      "require('node:module').syncBuiltinESMExports()",
    ].join('\n'))
    const env = { ...process.env, TMPDIR: join(dir, 'no-such-dir'), TMP: join(dir, 'no-such-dir'), TEMP: join(dir, 'no-such-dir') }
    const r = spawnSync(process.execPath, ['--require', deny, 'scripts/build.mjs', '--check'], { cwd: dir, encoding: 'utf8', env })
    assert.equal(r.status, 0, r.stderr)
    await assert.rejects(assertValidModule('desktop/plugin.js', 'const a = 1\nconst a = 2\n'), /desktop\/plugin\.js is not valid ESM/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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

test('CLI: a duplicate const the name scan cannot see fails the build, and --check, with a syntax error', async () => {
  const dir = await buildCopy()
  try {
    assert.equal(run(dir).status, 0)
    await writeFile(join(dir, 'desktop/src/ui-prefs.js'), '  const indentedTwin = 1\n', { flag: 'a' })
    await writeFile(join(dir, 'desktop/src/ui-flow.js'), 'const indentedTwin = 2\n', { flag: 'a' })
    for (const args of [[], ['--check']]) {
      const result = run(dir, ...args)
      assert.notEqual(result.status, 0, result.stdout)
      assert.match(result.stderr, /desktop\/plugin\.js is not valid ESM/)
      assert.match(result.stderr, /already been declared/)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI: a duplicate hidden behind a template literal or a comment fails the build as a name collision', async () => {
  const dir = await buildCopy()
  try {
    await writeFile(join(dir, 'desktop/src/ui-prefs.js'), "const tplTwin = `${'x'}`, hiddenTwin = 1\n", { flag: 'a' })
    await writeFile(join(dir, 'desktop/src/ui-flow.js'), 'const hiddenTwin = 2\n', { flag: 'a' })
    const result = run(dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /name collision: hiddenTwin declared by both ui-prefs\.js and ui-flow\.js/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the repository build output is up to date', () => {
  const result = run(repo, '--check')
  assert.equal(result.status, 0, result.stderr)
})
