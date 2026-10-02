// The one Prompt Studio build. Desktop loads a single desktop/plugin.js, generated whole from desktop/src/*:
//   plugin-head.js                         the imports and ID (the only file that may import)
//   // @studio-start .. // @studio-end    the detection core, the engines studio-core.js imports (each in its own scope), i18n-core, studio-core
//   // @ui-i18n-start .. // @ui-i18n-end  desktop/src/i18n-ui.js
//   UI_FILES (below), concatenated verbatim  studio-state.js holds the // @core-start .. // @core-end reducer
// and desktop/studio-core.mjs (same code, with exports) is written for the Node tests.
// The keyboard table of README.md, between its marker comments, is generated from the SHORTCUTS map (SHORTCUTS_SOURCE
// below) and the `shortcuts.*` labels of i18n-ui.js; a plain build rewrites it, `--check` fails when it is stale.
// Both outputs are syntax-checked as ES modules before anything is written or compared.
// `node scripts/build.mjs --check` writes nothing and exits 1 when either output is stale.
import { readFile, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const url = path => new URL(`../${path}`, import.meta.url)
const read = path => readFile(url(path), 'utf8')
// Like read, but a missing file is null: --check must tell "missing" from "stale".
const readIfPresent = path => read(path).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)))

const IMPORT_LINE = /^import\s[^\n]*\n/gm
export const stripImports = source => source.replace(IMPORT_LINE, '')

// `export const|let|var|function|class|async function` loses its keyword; `export default function|class` too;
// `export { a, b }` (one or many lines) is dropped. Re-exports and `export default <expression>` cannot be inlined.
// Only real statements count: text that looks like an export inside a string, template literal or comment is kept.
export function stripExports(source) {
  if (codeMatches(source, /^export\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\b/gm)) throw new Error('re-export (`export ... from`) cannot be inlined into the single-scope build')
  const defaults = replaceInCode(source, /^export default (?=(?:async function|function|class)\b)/gm, '')
  if (codeMatches(defaults, /^export\s+default\b/gm)) throw new Error('`export default` is only supported before a named function or class')
  const lists = replaceInCode(defaults, /^export\s*\{[^}]*\}[ \t]*;?[ \t]*(?:\r?\n|$)/gm, '')
  return replaceInCode(lists, /^export (?=(?:const|let|var|function|class|async function)\b)/gm, '')
}

// Spans walk() skips (strings, template literals, comments, regex literals), as sorted [start, end) pairs.
function skippedSpans(source) {
  const spans = []
  walk(source, () => false, 0, (start, end) => spans.push([start, end]))
  return spans
}
const inSpan = (spans, i) => spans.some(([start, end]) => start <= i && i < end)
// pattern must be global: a match that starts inside a skipped span is not code.
function codeMatches(source, pattern) {
  const spans = skippedSpans(source)
  for (const m of source.matchAll(pattern)) if (!inSpan(spans, m.index)) return true
  return false
}
function replaceInCode(source, pattern, replacement) {
  const spans = skippedSpans(source)
  return source.replace(pattern, (match, ...rest) => {
    const offset = rest.find(value => typeof value === 'number')
    return inSpan(spans, offset) ? match : replacement
  })
}

// Walk source code, skipping strings, template literals, comments and regex literals. visit(i, ch, depth, prev) sees
// every other character with the ([{ nesting depth before it and the previous significant character; returning true
// stops the walk. onSkip(start, end), when given, sees every skipped span (string, template, comment, regex). Returns
// the index where it stopped.
// A slash after one of these words opens a regex literal (`return /'/.test(s)`), not a division. The word is the
// previous significant token, so a comment between them (`return /* note */ /'/`) changes nothing; after a dot it is
// a property name (`a.in / 2`), not the keyword.
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])
// A slash right after the closing parenthesis of one of these conditions starts a statement: a regex (`if (s) /'/`).
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'with'])
// `count++ / 2`: a `++` or `--` right after a value (a name, `)` or `]`) is postfix, so the slash after it divides.
function postfixBefore(source, prev, prevAt) {
  if ((prev !== '+' && prev !== '-') || prevAt < 1 || source[prevAt - 1] !== prev) return false
  let k = prevAt - 2
  while (k >= 0 && /\s/.test(source[k])) k--
  return k >= 0 && /[\w$)\]]/.test(source[k])
}
function walk(source, visit, from = 0, onSkip = () => {}) {
  const quoted = new Set(['"', "'", '`'])
  let depth = 0
  let prev = ''
  let word = ''
  let wordEnd = -1
  let wordAfterDot = false
  const parens = []
  let afterControl = false
  let prevAt = -1
  let i = from
  // A '…' or "…" string cannot cross a line break (JavaScript forbids it), so a quote misread inside a regex hides at
  // most the rest of its own line, never the declarations after it.
  const skipString = (start) => {
    const quote = source[start]
    let j = start + 1
    while (j < source.length && source[j] !== quote) {
      if (quote !== '`' && source[j] === '\n') return j
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
    if (quoted.has(ch)) { const start = i; i = skipString(i); onSkip(start, i); prev = 'x'; word = ''; continue }
    if (ch === '/' && !postfixBefore(source, prev, prevAt) && (prev === '' || '=(,:[!&|?{};+-*%<>~^'.includes(prev) || (!wordAfterDot && REGEX_KEYWORDS.has(word)) || (prev === ')' && afterControl))) {
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
      word = ''
      continue
    }
    if (visit(i, ch, depth, prev)) return i
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === '(') parens.push(!wordAfterDot && CONTROL_WORDS.has(word))
    if (!/\s/.test(ch)) afterControl = ch === ')' && parens.pop() === true
    if (/[\w$]/.test(ch)) {
      if (wordEnd !== i - 1) { wordAfterDot = prev === '.'; word = '' }
      word += ch
      wordEnd = i
    } else if (!/\s/.test(ch)) word = ''
    if (!/\s/.test(ch)) { prev = ch; prevAt = i }
    i++
  }
  return i
}

// The source with comments blanked and each string, template literal or regex literal reduced to a lone `0`; line
// breaks and offsets are kept. Name scanning then cannot be fooled by declaration-looking text inside them.
function maskNonCode(source) {
  // UTF-16 code units, the offsets walk() reports: code points would shift every mask after an emoji.
  const chars = source.split('')
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
// duplicate binding in a declaration form it does not parse. The check runs in this process, with no child process
// and no file written, so `--check` also works in a read-only sandbox: the module is imported from a data: URL with
// one more import that can never resolve, so Node parses it, then fails to link it and never runs any of its code.
const NEVER_RESOLVES = 'ps-build-syntax-check:never'
export async function assertValidModule(label, source) {
  const url = `data:text/javascript;base64,${Buffer.from(`${source}\nimport '${NEVER_RESOLVES}'\n`).toString('base64')}`
  try {
    await import(url)
  } catch (error) {
    if (error instanceof SyntaxError && error.code === undefined) throw new Error(`${label} is not valid ESM:\n${error.message}`)
    return
  }
  throw new Error(`${label}: the syntax check ran the module instead of stopping at its imports`)
}

// expected / actual: { path: text }; actual is null for a file that does not exist.
export function compareOutputs(expected, actual) {
  const missing = Object.keys(expected).filter(path => actual[path] == null)
  const stale = Object.keys(expected).filter(path => actual[path] != null && actual[path] !== expected[path])
  return { missing, stale }
}

// The detection core (draft recognition, rules as data) is shared by the engines. It is inlined once, before them, as
// DETECTION; an engine may import only that name from it. The core itself imports nothing.
const DETECTION_FILE = 'detection-core.js'
const DETECTION_IMPORT = `import { DETECTION } from './${DETECTION_FILE}'`
function detectionModule(source) {
  if (/^import\b/m.test(source)) throw new Error(`${DETECTION_FILE} must not import anything`)
  return `// desktop/src/${DETECTION_FILE}\nconst DETECTION = (() => {\n${stripExports(source).trim()}\nreturn DETECTION\n})()`
}

// Each engine keeps its private names inside its own function scope; only NAME is exposed. The one import it may have
// is the detection core, which the build has already inlined as DETECTION.
function engineModule(source, name, file) {
  const imports = source.match(/^import\b[^\n]*$/gm) || []
  if (imports.some(line => line.trimEnd() !== DETECTION_IMPORT)) throw new Error(`${file} may import only the detection core: ${DETECTION_IMPORT}`)
  return `// ${file}\nconst ${name} = (() => {\n${stripExports(stripImports(source)).trim()}\nreturn ENGINE\n})()`
}

// The engines studio-core.js imports, in import order: the target registry lives in studio-core.js, so its imports
// are the build's engine list. Each is `import { ENGINE as NAME } from './engine-<id>.js'`.
export function studioEngines(coreSource) {
  const engines = []
  for (const m of coreSource.matchAll(/^import\s[^\n]*from\s+'\.\/(engine-[^']+\.js)'/gm)) {
    const named = /^import\s+\{\s*ENGINE\s+as\s+([A-Za-z_$][\w$]*)\s*\}/.exec(m[0])
    if (!named) throw new Error(`${m[1]} must be imported as: import { ENGINE as NAME } from './${m[1]}'`)
    engines.push({ file: m[1], name: named[1] })
  }
  return engines
}

// README keyboard table. SHORTCUTS_SOURCE is the one file that holds the SHORTCUTS map and OPEN_BINDING: when the map
// moves to another file, this line is the only change.
export const SHORTCUTS_SOURCE = 'desktop/src/ui-components.js'
export const SHORTCUT_TABLE_START = '<!-- shortcut-table:start -->'
export const SHORTCUT_TABLE_END = '<!-- shortcut-table:end -->'
// What the Studio draws on a Mac (displayCombo in ui-components.js): modifiers as glyphs, F-keys as plain F4.
const MAC_GLYPHS = { alt: '⌥', shift: '⇧', ctrl: '⌃', mod: '⌘' }
const PC_NAMES = { alt: 'Alt', shift: 'Shift', ctrl: 'Ctrl', mod: 'Ctrl' }

// The SHORTCUTS map and the Desktop binding that opens the studio, read from the source of SHORTCUTS_SOURCE.
// The map is an object literal that uses only TARGETS (the target registry), so it is evaluated with that.
export function readShortcutMap(source, targets) {
  const head = /^export const SHORTCUTS = (?=\{)/m.exec(source)
  if (!head) throw new Error(`no \`export const SHORTCUTS = {\` map in ${SHORTCUTS_SOURCE}`)
  const open = head.index + head[0].length
  const close = walk(source, (i, ch, depth) => ch === '}' && depth === 1, open)
  if (close >= source.length) throw new Error(`the SHORTCUTS map in ${SHORTCUTS_SOURCE} is not closed`)
  const shortcuts = new Function('TARGETS', `return (${source.slice(open, close + 1)})`)(targets)
  const binding = /^const OPEN_BINDING = '([^']+)'/m.exec(source)
  if (!binding) throw new Error(`no \`const OPEN_BINDING = '...'\` in ${SHORTCUTS_SOURCE}`)
  return { shortcuts, openBinding: binding[1] }
}

// One combo in the canonical notation ('Alt+Shift+1…9', 'mod+shift+e') as a Linux/Windows key or as a Mac key.
function showCombo(combo, mac) {
  const parts = combo.split('+')
  const base = parts.pop()
  const modifiers = parts.map(part => {
    const name = part.toLowerCase()
    if (!(name in MAC_GLYPHS)) throw new Error(`unknown modifier ${part} in ${combo}: add it to the tables of scripts/build.mjs and displayCombo`)
    return name
  })
  const key = base.length === 1 ? base.toUpperCase() : base
  if (mac) return (/^F\d+$/.test(base) ? '' : modifiers.map(name => MAC_GLYPHS[name]).join('')) + key
  return [...modifiers.map(name => PC_NAMES[name]), key].join('+')
}

// labels: the en `shortcuts` bundle of i18n-ui.js. Rows follow the map (the F1 order); an Alt twin shares its F-key row.
export function renderShortcutTable({ shortcuts, openBinding }, labels) {
  const rows = Object.entries(shortcuts).filter(([action]) => action !== 'alt').map(([action, value]) => {
    const label = labels[action]
    if (typeof label !== 'string' || !label) throw new Error(`no en label shortcuts.${action} in i18n-ui.js for the shortcut ${action}`)
    const combos = [typeof value === 'string' ? value : Object.values(value).join(' / '), shortcuts.alt?.[action]].filter(Boolean).join(' / ')
    const cell = mac => {
      const keys = combos.split(' / ').map(combo => showCombo(combo, mac)).join(' / ')
      return action === 'open' ? `${keys}, or ${showCombo(openBinding, mac)}` : keys
    }
    return `| ${cell(false)} | ${cell(true)} | ${label} |`
  })
  return ['| Linux and Windows | Mac | Action |', '|---|---|---|', ...rows].join('\n')
}

// The README with the text between the marker comments replaced by table; everything else is kept as written.
export function replaceShortcutTable(readme, table) {
  const start = readme.indexOf(SHORTCUT_TABLE_START)
  const end = readme.indexOf(SHORTCUT_TABLE_END)
  if (start < 0 || end < start) throw new Error(`README.md needs the marker comments ${SHORTCUT_TABLE_START} and ${SHORTCUT_TABLE_END}, in this order, around the keyboard table`)
  return `${readme.slice(0, start + SHORTCUT_TABLE_START.length)}\n${table}\n${readme.slice(end)}`
}

// Import a self-contained generated ESM source (no imports of its own) to read what it exports.
const importSource = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

// Hand-written plugin code, in plugin.js order. They share plugin.js's single module scope.
const UI_FILES = ['studio-state.js', 'ui-locale.js', 'ui-prefs.js', 'ui-flow.js', 'ui-components.js']

async function main() {
  const check = process.argv.includes('--check')

  const core = await read('desktop/src/studio-core.js')
  const engines = studioEngines(core)
  const engineSources = await Promise.all(engines.map(engine => read(`desktop/src/${engine.file}`)))
  const [detection, coreI18n, uiI18n, head, plugin, oldMjs, ...uiSources] = await Promise.all([
    read(`desktop/src/${DETECTION_FILE}`), read('desktop/src/i18n-core.js'), read('desktop/src/i18n-ui.js'), read('desktop/src/plugin-head.js'),
    readIfPresent('desktop/plugin.js'), readIfPresent('desktop/studio-core.mjs'),
    ...UI_FILES.map(file => read(`desktop/src/${file}`))
  ])
  UI_FILES.forEach((file, i) => {
    if (/^\s*import\b/m.test(uiSources[i])) throw new Error(`desktop/src/${file} must not import anything (imports live in plugin-head.js)`)
  })
  const ui = uiSources.join('')

  const coreImports = [...core.matchAll(/^import\s[^\n]*from\s+'([^']+)'/gm)].map(m => m[1]).sort()
  const allowed = [...engines.map(engine => `./${engine.file}`), './i18n-core.js'].sort()
  if (JSON.stringify(coreImports) !== JSON.stringify(allowed)) throw new Error(`studio-core.js may import only ${allowed.join(', ')}; found ${coreImports.join(', ')}`)

  const header = '// Generated by scripts/build.mjs from desktop/src/*: do not edit here.'
  const withExports = [
    header,
    detectionModule(detection),
    ...engines.map((engine, i) => engineModule(engineSources[i], engine.name, `desktop/src/${engine.file}`)),
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
    [DETECTION_FILE, 'const DETECTION = 0'],
    ...engines.map(engine => [engine.file, `const ${engine.name} = 0`]),
    ['i18n-core.js', coreI18n], ['studio-core.js', stripImports(core)], ['i18n-ui.js', uiI18n]
  ])

  const pluginHeader = `// Generated by scripts/build.mjs: do not edit here. Edit desktop/src/plugin-head.js, ${UI_FILES.map(f => `desktop/src/${f}`).join(', ')} (hand-written UI) or the inlined desktop/src/* modules, then run node scripts/build.mjs.\n`
  const next = `${pluginHeader}${head}// @studio-start\n${studioBlock}\n// @studio-end\n\n// @ui-i18n-start\n${uiBlock}\n// @ui-i18n-end\n\n${ui}`

  await assertValidModule('desktop/plugin.js', next)
  await assertValidModule('desktop/studio-core.mjs', mjs)

  const readme = await readIfPresent('README.md')
  if (readme === null) throw new Error('README.md is missing: it holds the generated keyboard table')
  const shortcutSource = await read(SHORTCUTS_SOURCE)
  const { TARGETS } = await importSource(mjs)
  const { UI_MESSAGES } = await importSource(uiI18n)
  const nextReadme = replaceShortcutTable(readme, renderShortcutTable(readShortcutMap(shortcutSource, TARGETS), UI_MESSAGES.en.shortcuts))

  if (check) {
    const { missing, stale } = compareOutputs({ 'desktop/plugin.js': next, 'desktop/studio-core.mjs': mjs }, { 'desktop/plugin.js': plugin, 'desktop/studio-core.mjs': oldMjs })
    if (missing.length) console.error(`missing build output: ${missing.join(', ')}. Run: node scripts/build.mjs`)
    if (stale.length) console.error(`stale build output: ${stale.join(', ')}. Run: node scripts/build.mjs`)
    const readmeStale = nextReadme !== readme
    if (readmeStale) console.error('stale README shortcut table: README.md does not match the SHORTCUTS map. Run: node scripts/build.mjs')
    if (missing.length || stale.length || readmeStale) process.exit(1)
    console.log('build output is up to date')
  } else {
    await writeFile(url('desktop/plugin.js'), next, 'utf8')
    await writeFile(url('desktop/studio-core.mjs'), mjs, 'utf8')
    if (nextReadme !== readme) await writeFile(url('README.md'), nextReadme, 'utf8')
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
