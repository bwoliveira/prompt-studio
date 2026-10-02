# 0005. A concatenation build with isolated engine scopes

Status: Accepted (2026-10-02)

## Context

Hermes Desktop loads one file per plugin, `desktop/plugin.js`, which may import only `@hermes/plugin-sdk`, `react` and
`react/jsx-runtime`. The Studio is too large for one hand-written file: three prompt engines, the step flow, two
translation bundles and the UI. The engines are written in the same shape, so their private helpers share names.

## Decision

`scripts/build.mjs` generates `desktop/plugin.js` whole from `desktop/src/*`, with no bundler:

- Each prompt engine is wrapped in its own function scope and exposes only its `ENGINE`, so identical private names in
  different engines cannot collide.
- The core, the translation bundles and the UI files are concatenated into the one module scope, with imports and exports
  stripped. Only `plugin-head.js` may import. The build fails on a top-level name declared twice and syntax-checks both
  outputs as ES modules.
- One exception to the isolation: the draft detection core, `desktop/src/detection-core.js` (ticket #29). It is inlined
  once, before the engines, as `DETECTION`, and an engine may import only `{ DETECTION }` from it; the core itself
  imports nothing. Any other import inside an engine fails the build.
- `desktop/studio-core.mjs`, the same code with exports, is generated for the Node tests.
- `node scripts/build.mjs --check` fails when `plugin.js`, `studio-core.mjs` or the README keyboard table is out of date.
  Nobody edits the generated files by hand.

## Consequences

- No build dependency beyond Node; the generated file is reviewable and CI checks that it is current.
- The build script carries its own export-stripping and name-collision logic, which has its own tests.
- Engines share no code through imports except the detection core above, so a recognition fix lands once; any other
  shared logic has to live in the one scope or be copied under a parity test.

Revisit when the dependencies are declared and a real need appears, such as shared modules across engines. The migration
to esbuild is deferred, not rejected.
