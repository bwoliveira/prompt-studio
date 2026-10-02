# Desktop development

Notes on the Desktop half. Setup, tests, CI and the pull-request flow are in `CONTRIBUTING.md`; the rules for coding agents
are in `AGENTS.md`; the standing decisions are in `docs/adr/`; the vocabulary is in `CONTEXT.md`.

## Layout

| Path | What it is |
|---|---|
| `desktop/src/detection-core.js` | Draft detection for every engine (what the draft asks for: the first verb decides, a question stays an answer; rules as data). Pure ESM, no imports, no DOM, deterministic. |
| `desktop/src/engine-opus.js` | Claude Opus 5.5 prompt engine. Pure ESM, deterministic; imports only the detection core (`import { DETECTION } from './detection-core.js'`), no DOM. |
| `desktop/src/engine-astra.js` | GPT-6 Astra prompt engine. Same shape and rules. |
| `desktop/src/engine-sonnet.js` | Claude Sonnet 5.5 prompt engine. Same shape and rules. |
| `desktop/src/studio-core.js` | Step flow (questions, recommendations, answers to brief). Holds the target registry (`TARGETS`: id, label, model, key, default-target pattern, engine, capabilities); imports only the engines and `i18n-core.js`. The build reads its engine list from those imports. |
| `desktop/src/i18n-core.js` | Questions, help and option labels, `en` and `pt`. |
| `desktop/src/i18n-ui.js` | Every string `plugin.js` shows (buttons, notes, errors, shortcut help), `en` and `pt`. |
| `desktop/src/plugin-head.js` | The plugin's imports and `ID`; the only hand-written file allowed to import. |
| `desktop/src/studio-state.js` | The `@core` state machine (reducer), the studio atom and the one `lifecycle` object that holds every piece of module-level mutable state (plugin context, opened address, serial counters, timers, suggestion cache). No imports. |
| `desktop/src/ui-locale.js`, `ui-keys.js`, `ui-settings.js`, `ui-suggestions.js`, `ui-steps.js`, `ui-composer.js` | The rest of the Desktop UI, one module per responsibility: locale helpers and the composer adapter; the shortcut map, key display and keydown listener; preferences, Settings and the model picker; the suggestion machine; the strip and the step flow; opening from the composer, host calls, placing, closing and `export default`. Concatenated in this order into `plugin.js`'s single module scope. No imports. |
| `desktop/plugin.js` | Generated whole by `scripts/build.mjs`; the single file Hermes Desktop loads. Imports only `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`. |
| `desktop/studio-core.mjs` | Generated ESM bundle of `src/*` for the Node tests. |

`plugin.js` is fully generated (it keeps the marker comments `// @studio-start` / `// @studio-end`, `@ui-i18n` and
`@core` because tests read them). Never edit it: edit `desktop/src/*` and rebuild. Every rule line in an engine carries a comment with its doc source; add the matching row to
`docs/PROMPT-DOCS-REVIEW.md` when you add or change one.

## Build

```bash
node scripts/build.mjs          # inline desktop/src/* into plugin.js and write desktop/studio-core.mjs
node scripts/build.mjs --check  # exit 1 if plugin.js, studio-core.mjs or the README shortcut table are out of date (run in CI / before commit)
```

The same build writes the keyboard table of `README.md` between its `shortcut-table` marker comments, from the `SHORTCUTS`
map (named once, as `SHORTCUTS_SOURCE` in `scripts/build.mjs`) and the `shortcuts.*` labels of `i18n-ui.js`. Never edit that
table by hand. The build reads the sources with `acorn` (a pinned dev dependency: run `npm ci` once before the first build),
so export stripping and the name-collision check work on the parsed program, never on a guess about strings, regexes or
template literals. Why the build is a concatenation with isolated engine scopes: `docs/adr/0005-concatenation-build-with-isolated-engine-scopes.md`.

## Tests and validation

`npm test`, `npm run test:bin`, the Python tests, `hermes plugins validate .`, the dependency pins, the memory cap and CI
are described in `CONTRIBUTING.md`. The doc snapshots behind `scripts/docs_sources.py` live outside the plugin; see
`docs/sources/README.md`.

## Test seams

The plugin has no test mode. The three timing values the UI tests shorten are read from one global,
`globalThis.__promptStudioTest`, and fall back to the real constant when it is absent (it never exists in Hermes Desktop).
Tests create it as `{}` before loading `plugin.js` and set a field for the length of one test (`tests/desktop/studio-flow.test.mjs`
also keeps its SDK stub flags on it). No other global is read by `desktop/src/*`; a new seam is a new field here, with a
row in this table.

| Field | Replaces | Default |
|---|---|---|
| `autoSuggestDelayMs` | the pause before Auto asks the AI for a step suggestion (`AUTO_SUGGEST_DELAY_MS`, `ui-suggestions.js`) | the constant |
| `contextTimeoutMs` | how long the Studio waits for `/context` (`CONTEXT_CLIENT_TIMEOUT_MS`, `ui-composer.js`) | the constant |
| `focusSettleMs` | how long the composer focus is retried after a write (`FOCUS_SETTLE_MS`, `ui-composer.js`) | the constant |

## i18n

The UI is English-first through the Desktop plugin i18n API: `ctx.i18n.register(bundles)` in `register()`,
`usePluginI18n(id)` in React, `ctx.i18n.t` outside React. Rule: the `en` and `pt` bundles must have exactly the same
keys, and every key the UI asks for exists in both (the tests check both: `studio-core.test.mjs` compares the two
bundles; the last test of `studio-flow.test.mjs` checks each key the UI asked `ctx.i18n.t` for while the flow tests ran).
Add a key to both in the same change and delete it from both when its last use goes (no test finds a key nothing reads).
`errors.<code>` is the backend's code table: `studio-core.test.mjs` requires one text per code a client can receive
(`docs/CONTRACT.md`) and none for a code the REST routes cannot return; `tests/test_contract.py` checks that table against
what the routes answer. Generated prompts are not translated: section
headers and rule lines stay English, and the user's text is copied as written.

## Draft recognition languages

The draft recognizers support Portuguese and English only. The recognition rules live once, in
`desktop/src/detection-core.js`, as data: `DETECTION.createDetector(profile)` takes a profile of rule lines
(`verbs`, `categories`, `dataNoun`, `dataUnless`, `foldLimit`) and returns the detector. An engine passes only the rule
lines in which it differs: Opus and Sonnet read the default profile, Astra passes its own verbs and data rule
(`desktop/src/engine-astra.js`, `DETECTOR`). A recognition fix is made in the core and reaches every target. The
other keyword regexes (`UI_*`, `*_NOUN`, `ASK_FIRST`, subagent and format hints in `engine-astra.js`; `INTERFACE` in
`engine-opus.js` and `engine-sonnet.js`) stay in their engine. The core lower-cases the draft and strips diacritics
first (`fold()`), so the Portuguese words are written without accents. The dashboard's
`REQUIRED_LINES` proof words and `_AUTONOMY_HEADERS` in `dashboard/suggest_engine.py` are also
English + Portuguese. Each pattern carries a `Languages:` comment; other languages fall back to defaults.
The first verb in the draft decides the deliverable. `tests/desktop/draft-recognition.test.mjs` holds the draft table
all three engines must agree on; `tests/desktop/detection-core.test.mjs` fails when an engine declares a detection
rule of its own, and the build allows an engine no import but the core (`node scripts/build.mjs`).

## Keyboard

- While the studio is closed, only **F4** is handled (open the studio, and only when the composer is on screen).
  The other way in is a binding in Hermes Desktop's `keybinds` area (`OPEN_BINDING`, default `mod+shift+e`, id
  `prompt-studio.start` like the palette command): Desktop dispatches it and runs `startFromComposer`, so the
  studio's listener never sees it. Its default must stay out of Desktop's own default actions
  (`tests/desktop/fixtures/hermes-desktop-default-keybinds-*.txt`).
- While it is open, a key works only if a visible control prints it. The key is shown on the control, so what is
  shown is what runs. F5-F10 and their Alt letters (`SHORTCUTS.alt`) are always swallowed while open (F5 could
  reload the window; a Mac would type the Option symbol). The Alt letters never use E, I, N or U (Option dead keys).
- Never taken by the key listener: Tab, Enter, Esc, and any Ctrl or Super chord. F-keys with a modifier are ignored.
  The answer textarea stops propagation of its own keys so typing never reaches the composer's handlers.
- Capture phase, so keys work with the cursor in the answer field; IME composition is left alone.
- F1 shows the full map. The `SHORTCUTS` map in `desktop/src/ui-keys.js` is the only place a key is written; the `shortcuts.*` labels in `i18n-ui.js` name each entry (they are also the Action column of the README table). The reasons are in `docs/adr/0004-f-keys-plus-alt-letters-never-enter.md`.

The full key table, for Linux/Windows and for a Mac, is the generated table in `README.md` (the same keys as the F1 list).

Either Alt works, except where the right Alt is AltGr. Alt+digits follow the physical number row.

The map holds the canonical combos (`aria-keyshortcuts`, `data-studio-shortcut`, tests). What the user reads
goes through `displayCombo` in `ui-keys.js`: on a Mac `Alt+Shift+1…9` shows as ⌥⇧1…9 and `F4` as plain F4 (never "fn F4"), with the
modifier glyphs from the SDK's `formatModifierToken` when the Desktop exports it (0.21.4+) and a local table otherwise.
The key listener reads an Alt chord on a `Key*`/`Digit*` code even when the event is `key: 'Dead'`, `keyCode: 229` or
`isComposing` (macOS Option dead keys); other composition is ignored. It never handles Enter, Tab, Esc or Ctrl/Super chords.

## Composer access

`composerAdapter` in `desktop/src/ui-locale.js` reads and writes the message field only through the SDK's
`host.composer` (Hermes Desktop 0.21.5+), addressed with `null` (the composer in use): `getDraft` to start,
`setDraft` to empty it, return the draft on Close and place the prompt; F9 uses `submit` for the session the Studio
was opened in. The plugin changes nothing in the app's DOM (`docs/adr/0003-host-composer-only.md`); its key listener only reads which dialogs, menus and listboxes are
open (ARIA roles and visibility) to stand back behind them, which depends on the host marking its overlays that way. The SDK has no attachment API, so attachments are not read: they stay
in the composer, go with the prompt on Alt+E and are not sent by F9 (the preview says so).

## Try it in Hermes Desktop

1. `node scripts/build.mjs`, then copy `desktop/plugin.js` to `desktop-plugins/prompt-studio/plugin.js` under your
   Hermes home (`$HERMES_HOME`, usually `~/.hermes`) and reopen Hermes Desktop. The dashboard backend is installed
   with the plugin (`./install.sh` from this checkout); its REST base is `/api/plugins/prompt-studio`.
2. Type a draft and press F4 (or click **Prompt Studio**): the draft moves into the studio and the composer empties.
3. Each step shows the AI suggestion on its own in automatic mode; confirm, pick an option or skip. **Back**
   restores the previous answer.
4. **Close** puts the original draft back.
5. **Generate**, then **Put in composer to edit**: the prompt lands in the composer, attachments still there; it is not sent.
6. With the backend route failing, **Generate** still places the engine's prompt with a warning.

The AI model used by the studio is the auxiliary task `prompt_studio` in the Hermes config
(`auxiliary.prompt_studio`) unless a model is picked in Settings (F3); picks live in the plugin storage
(`helperModel`, `contextModel`, `readContext`, `language`) and the plugin never edits the config.

## Workflow

The same as `AGENTS.md`; read it first.

- Change only what the task needs. Edit `desktop/src/*` and run `node scripts/build.mjs`; never edit `desktop/plugin.js` or
  `desktop/studio-core.mjs`.
- New behavior comes with tests, and each fix starts with a failing test: the commit message names the test that failed
  first (`Failing first: <test file> "<test name>"`). UI tests never compare jsdom nodes with `assert.equal`/`deepEqual`.
- Every user-visible change gets a line in `CHANGELOG.md` under `## Unreleased`; versions are bumped only when a release is cut.
- One subject per branch (`<type>/<subject>`). Before the first `bin/pr` of a branch, two reviews, in this order: the Hermes
  `/review`, then the local Codex review that `bin/pr` runs. P0, P1 and P2 findings are fixed, with a test, until none is left.
- The plugin sends no sampling parameters to the model (`docs/adr/0001-no-sampling-parameters.md`).
