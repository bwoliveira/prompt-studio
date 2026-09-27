// Prints the runtime (value) export names of a Hermes Desktop SDK index.ts, one per line, sorted.
// Used to regenerate tests/desktop/fixtures/hermes-sdk-exports-<version>.txt, e.g. for 0.21.4:
//   git -C /usr/local/lib/hermes-agent show v2026.9.21:apps/desktop/src/sdk/index.ts > /tmp/index.ts
//   NODE_PATH=/usr/local/lib/hermes-agent/node_modules node scripts/sdk-exports.mjs /tmp/index.ts
// Type-only exports are dropped: the runtime shim re-exports only Object.keys(sdk).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require(require.resolve('typescript', { paths: (process.env.NODE_PATH || '').split(':') }))
const file = process.argv[2]
const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = new Set()
const exported = n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
for (const s of src.statements) {
  if (ts.isExportDeclaration(s)) {
    if (s.isTypeOnly) continue
    if (!s.exportClause) throw new Error('export * without a name is not supported')
    if (ts.isNamespaceExport(s.exportClause)) { names.add(s.exportClause.name.text); continue }
    for (const e of s.exportClause.elements) if (!e.isTypeOnly) names.add(e.name.text)
  } else if (exported(s)) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) names.add(d.name.text)
    else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) names.add(s.name.text)
  }
}
console.log([...names].sort().join('\n'))
