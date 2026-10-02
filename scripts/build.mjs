// The one Prompt Studio build. Desktop loads a single desktop/plugin.js, generated whole from desktop/src/*:
//   plugin-head.js                         the imports and ID (the only file that may import)
//   // @studio-start .. // @studio-end    engine-opus, engine-astra, engine-sonnet (each in its own scope), i18n-core, studio-core
//   // @ui-i18n-start .. // @ui-i18n-end  desktop/src/i18n-ui.js
//   UI_FILES (below), concatenated verbatim  studio-state.js holds the // @core-start .. // @core-end reducer
// and desktop/studio-core.mjs (same code, with exports) is written for the Node tests.
// Both outputs are syntax-checked as ES modules before anything is written or compared.
// `node scripts/build.mjs --check` writes nothing and exits 1 when either output is stale.
import { readFile, writeFile } from 'node:fs/promises'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const url = path => new URL(`../${path}`, import.meta.url)
const read = path => readFile(url(path), 'utf8')
// Like read, but a missing file is null: --check must tell "missing" from "stale".
const readIfPresent = path => read(path).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)))

const IMPORT_LINE = /^import\s[^\n]*\n/gm
export const stripImports = source => source.replace(IMPORT_LINE, '')

// `export const|let|var|function|class|async function` loses its keyword; `export default function|class` too;
// `export { a, b }` (one or many lines) is dropped. Re-exports and `export default <expression>` cannot be inlined.
export function stripExports(source) {
  if (/^export\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\b/m.test(source)) throw new Error('re-export (`export ... from`) cannot be inlined into the single-scope build')
  const defaults = source.replace(/^export default (?=(?:async function|function|class)\b)/gm, '')
  if (/^export\s+default\b/m.test(defaults)) throw new Error('`export default` is only supported before a named function or class')
  return defaults
    .replace(/^export\s*\{[^}]*\}[ \t]*;?[ \t]*(?:\r?\n|$)/gm, '')
    .replace(/^export (?=(?:const|let|var|function|class|async function)\b)/gm, '')
}

// Walk source code, skipping strings, template literals, comments and regex literals. visit(i, ch, depth, prev) sees
// every other character with the ([{ nesting depth before it and the previous significant character; returning true
// stops the walk. onSkip(start, end), when given, sees every skipped span (string, template, comment, regex). Returns
// the index where it stopped.
function walk(source, visit, from = 0, onSkip = () => {}) {
  const quoted = new Set(['"', "'", '`'])
  let depth = 0
  let prev = ''
  let i = from
  const skipString = (start) => {
    const quote = source[start]
    let j = start + 1
    while (j < source.length && source[j] !== quote) {
      if (source[j] === '\\') j++
      else if (quote === '`' && source[j] === '$' && source[j + 1] === '{') {
        let nest = 1
        j += 2
        while (j < source.length && nest) {
          if (quoted.has(source[j])) { j = skipString(j); continue }
          if (source[j] === '{') nest++
          else if (source[j] === '}') nest--
          j++
        }
        continue
      }
      j++
    }
    return j + 1
  }
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') { const start = i; while (i < source.length && source[i] !== '\n') i++; onSkip(start, i); continue }
    if (ch === '/' && source[i + 1] === '*') { const start = i; const close = source.indexOf('*/', i + 2); i = close < 0 ? source.length : close + 2; onSkip(start, i); continue }
    if (quoted.has(ch)) { const start = i; i = skipString(i); onSkip(start, i); prev = 'x'; continue }
    if (ch === '/' && (prev === '' || '=(,:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1
      let inClass = false
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++
        else if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        j++
      }
      onSkip(i, j + 1)
      i = j + 1
      prev = 'x'
      continue
    }
    if (visit(i, ch, depth, prev)) return i
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (!/\s/.test(ch)) prev = ch
    i++
  }
  return i
}

// The source with comments blanked and each string, template literal or regex literal reduced to a lone `0`; line
// breaks and offsets are kept. Name scanning then cannot be fooled by declaration-looking text inside them.
function maskNonCode(source) {
  const chars = [...source]
  walk(source, () => false, 0, (start, end) => {
    const isComment = source[start] === '/' && (source[start + 1] === '/' || source[start + 1] === '*')
    for (let k = start; k < Math.min(end, chars.length); k++) if (chars[k] !== '\n') chars[k] = ' '
    if (!isComment) chars[start] = '0'
  })
  return chars.join('')
}

// Split text at top-level (depth 0, outside strings and comments) occurrences of sep.
function splitTop(text, sep) {
  const parts = []
  let last = 0
  walk(text, (i, ch, depth) => {
    if (depth === 0 && ch === sep) { parts.push(text.slice(last, i)); last = i + 1 }
  })
  parts.push(text.slice(last))
  return parts
}

// Names bound by a declarator target: `a`, `{a, b: c, d = 1, ...e}`, `[p, , q = 2, ...r]`, nested.
function bindingNames(target, out) {
  const text = target.trim()
  if (!text) return
  if (text[0] === '{' || text[0] === '[') {
    for (const element of splitTop(text.slice(1, -1), ',')) {
      let item = element.trim()
      if (item.startsWith('...')) item = item.slice(3)
      else if (text[0] === '{') item = splitTop(item, ':').slice(1).join(':').trim() || item
      bindingNames(splitTop(item, '=')[0], out)
    }
  } else if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    out.add(text)
  }
}

// Does the declaration continue on the next line? It does after an operator or comma, and before a leading operator.
function continuesAfterNewline(source, at, prev) {
  if (prev && ',=+-*/%&|^?:<>!~'.includes(prev)) return true
  let j = at
  for (;;) {
    while (j < source.length && /\s/.test(source[j])) j++
    if (source[j] === '/' && source[j + 1] === '/') { while (j < source.length && source[j] !== '\n') j++ }
    else if (source[j] === '/' && source[j + 1] === '*') { const close = source.indexOf('*/', j + 2); j = close < 0 ? source.length : close + 2 }
    else break
  }
  return j < source.length && ',.?:&|*%^<>=+-'.includes(source[j])
}

// Names declared by one const/let/var statement starting right after the keyword: every comma-separated declarator.
function declaredNames(source, from, out) {
  const declarators = []
  let last = from
  const stop = walk(source, (i, ch, depth, prev) => {
    if (depth !== 0) return false
    if (ch === ',') { declarators.push(source.slice(last, i)); last = i + 1 }
    else if (ch === ';') return true
    else if (ch === '\n' && !continuesAfterNewline(source, i, prev)) return true
    return false
  }, from)
  declarators.push(source.slice(last, stop))
  for (const declarator of declarators) {
    const [binding] = splitTop(declarator, '=')
    bindingNames(binding, out)
  }
}

// Top-level declared names (column 0), to prove the inlined code cannot collide with plugin.js.
export function topLevelNames(code) {
  const source = maskNonCode(code)
  const names = new Set()
  for (const m of source.matchAll(/^(?:export\s+)?(?:class|function\s*\*?|async\s+function\s*\*?)\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^(?:export\s+)?(?:const|let|var)\s+/gm)) declaredNames(source, m.index + m[0].length, names)
  for (const m of source.matchAll(/^import\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.add(name)
    }
  }
  for (const m of source.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^import\s+[A-Za-z_$][\w$]*\s*,\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) names.add(name)
    }
  }
  return names
}

// All entries share plugin.js's single module scope (engines expose only their NAME): [label, source] in file order.
// A top-level name declared twice, within one file or across any two, fails the build.
export function findCollisions(entries) {
  const seen = new Map()
  for (const [label, source] of entries) {
    for (const name of topLevelNames(source)) {
      if (seen.has(name)) throw new Error(`name collision: ${name} declared by both ${seen.get(name)} and ${label}`)
      seen.set(name, label)
    }
  }
}

// Syntax-check a generated module the way Node itself would load it: catches what the name scan cannot, such as a
// duplicate binding in a declaration form it does not parse.
export function assertValidModule(label, source) {
  const dir = mkdtempSync(join(tmpdir(), 'ps-syntax-'))
  try {
    const file = join(dir, 'bundle.mjs')
    writeFileSync(file, source)
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) {
      const detail = result.stderr.split('\n').filter(line => line.trim()).slice(0, 6).join('\n')
      throw new Error(`${label} is not valid ESM:\n${detail}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// expected / actual: { path: text }; actual is null for a file that does not exist.
export function compareOutputs(expected, actual) {
  const missing = Object.keys(expected).filter(path => actual[path] == null)
  const stale = Object.keys(expected).filter(path => actual[path] != null && actual[path] !== expected[path])
  return { missing, stale }
}

// Each engine keeps its private names inside its own function scope; only NAME is exposed.
function engineModule(source, name, file) {
  if (/^import\s/m.test(source)) throw new Error(`${file} must not import anything`)
  return `// ${file}\nconst ${name} = (() => {\n${stripExports(source).trim()}\nreturn ENGINE\n})()`
}

// Hand-written plugin code, in plugin.js order. They share plugin.js's single module scope.
const UI_FILES = ['studio-state.js', 'ui-locale.js', 'ui-prefs.js', 'ui-flow.js', 'ui-components.js']

async function main() {
  const check = process.argv.includes('--check')

  const [opus, astra, sonnet, coreI18n, core, uiI18n, head, plugin, oldMjs, ...uiSources] = await Promise.all([
    read('desktop/src/engine-opus.js'), read('desktop/src/engine-astra.js'), read('desktop/src/engine-sonnet.js'), read('desktop/src/i18n-core.js'),
    read('desktop/src/studio-core.js'), read('desktop/src/i18n-ui.js'), read('desktop/src/plugin-head.js'),
    readIfPresent('desktop/plugin.js'), readIfPresent('desktop/studio-core.mjs'),
    ...UI_FILES.map(file => read(`desktop/src/${file}`))
  ])
  UI_FILES.forEach((file, i) => {
    if (/^\s*import\b/m.test(uiSources[i])) throw new Error(`desktop/src/${file} must not import anything (imports live in plugin-head.js)`)
  })
  const ui = uiSources.join('')

  const coreImports = [...core.matchAll(/^import\s[^\n]*from\s+'([^']+)'/gm)].map(m => m[1]).sort()
  const allowed = ['./engine-astra.js', './engine-opus.js', './engine-sonnet.js', './i18n-core.js']
  if (JSON.stringify(coreImports) !== JSON.stringify(allowed)) throw new Error(`studio-core.js may import only ${allowed.join(', ')}; found ${coreImports.join(', ')}`)

  const header = '// Generated by scripts/build.mjs from desktop/src/*: do not edit here.'
  const withExports = [
    header,
    engineModule(opus, 'OPUS_ENGINE', 'desktop/src/engine-opus.js'),
    engineModule(astra, 'ASTRA_ENGINE', 'desktop/src/engine-astra.js'),
    engineModule(sonnet, 'SONNET_ENGINE', 'desktop/src/engine-sonnet.js'),
    `// desktop/src/i18n-core.js\n${coreI18n.trim()}`,
    `// desktop/src/studio-core.js\n${stripImports(core).trim()}`
  ].join('\n\n')
  const mjs = `${withExports}\n`
  const studioBlock = stripExports(withExports)
  const uiBlock = `// Copied from desktop/src/i18n-ui.js (the build inlines it; do not edit here).\n${stripExports(uiI18n).trim()}`

  // Collision check: every top-level name of plugin.js (head, each UI file, the inlined blocks) is declared once.
  // Engine internals live in their own function scope, so only their exposed names count.
  findCollisions([
    ['plugin-head.js', head],
    ...UI_FILES.map((file, i) => [file, uiSources[i]]),
    ['engine-opus.js', 'const OPUS_ENGINE = 0'], ['engine-astra.js', 'const ASTRA_ENGINE = 0'], ['engine-sonnet.js', 'const SONNET_ENGINE = 0'],
    ['i18n-core.js', coreI18n], ['studio-core.js', stripImports(core)], ['i18n-ui.js', uiI18n]
  ])

  const pluginHeader = `// Generated by scripts/build.mjs: do not edit here. Edit desktop/src/plugin-head.js, ${UI_FILES.map(f => `desktop/src/${f}`).join(', ')} (hand-written UI) or the inlined desktop/src/* modules, then run node scripts/build.mjs.\n`
  const next = `${pluginHeader}${head}// @studio-start\n${studioBlock}\n// @studio-end\n\n// @ui-i18n-start\n${uiBlock}\n// @ui-i18n-end\n\n${ui}`

  assertValidModule('desktop/plugin.js', next)
  assertValidModule('desktop/studio-core.mjs', mjs)

  if (check) {
    const { missing, stale } = compareOutputs({ 'desktop/plugin.js': next, 'desktop/studio-core.mjs': mjs }, { 'desktop/plugin.js': plugin, 'desktop/studio-core.mjs': oldMjs })
    if (missing.length) console.error(`missing build output: ${missing.join(', ')}. Run: node scripts/build.mjs`)
    if (stale.length) console.error(`stale build output: ${stale.join(', ')}. Run: node scripts/build.mjs`)
    if (missing.length || stale.length) process.exit(1)
    console.log('build output is up to date')
  } else {
    await writeFile(url('desktop/plugin.js'), next, 'utf8')
    await writeFile(url('desktop/studio-core.mjs'), mjs, 'utf8')
    console.log(`studio block: ${studioBlock.length} chars; ui-i18n block: ${uiBlock.length} chars`)
  }
}

// Run as a CLI, not when the tests import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
