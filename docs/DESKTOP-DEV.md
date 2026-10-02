# Desktop development

## Layout

| Path | What it is |
|---|---|
| `desktop/src/engine-opus.js` | Claude Opus 5.5 prompt engine. Pure ESM, no imports, no DOM, deterministic. |
| `desktop/src/engine-astra.js` | GPT-6 Astra prompt engine. Same shape and rules. |
| `desktop/src/engine-sonnet.js` | Claude Sonnet 5.5 prompt engine. Same shape and rules. |
| `desktop/src/studio-core.js` | Step flow (questions, recommendations, answers to brief). Holds the target registry (`TARGETS`: id, label, model, key, default-target pattern, engine, capabilities); imports only the engines and `i18n-core.js`. The build reads its engine list from those imports. |
| `desktop/src/i18n-core.js` | Questions, help and option labels, `en` and `pt`. |
| `desktop/src/i18n-ui.js` | Every string `plugin.js` shows (buttons, notes, errors, shortcut help), `en` and `pt`. |
| `desktop/src/plugin-head.js` | The plugin's imports and `ID`; the only hand-written file allowed to import. |
| `desktop/src/studio-state.js` | The `@core` state machine (reducer) plus the studio atom. No imports. |
| `desktop/src/ui-locale.js`, `ui-prefs.js`, `ui-flow.js`, `ui-components.js` | The rest of the Desktop UI (locale helpers, preferences and context, flow and keys, components and `export default`), concatenated in this order into `plugin.js`'s single module scope. No imports. |
| `desktop/plugin.js` | Generated whole by `scripts/build.mjs`; the single file Hermes Desktop loads. Imports only `@hermes/plugin-sdk`, `react` and `react/jsx-runtime`. |
| `desktop/studio-core.mjs` | Generated ESM bundle of `src/*` for the Node tests. |

`plugin.js` is fully generated (it keeps the marker comments `// @studio-start` / `// @studio-end`, `@ui-i18n` and
`@core` because tests read them). Never edit it: edit `desktop/src/*` and rebuild. Every rule line in an engine carries a comment with its doc source; add the matching row to
`docs/PROMPT-DOCS-REVIEW.md` when you add or change one.

## Build

```bash
node scripts/build.mjs          # inline desktop/src/* into plugin.js and write desktop/studio-core.mjs
node scripts/build.mjs --check  # exit 1 if plugin.js or studio-core.mjs are out of date (run in CI / before commit)
```

## Tests and validation

```bash
npm ci                            # once: the pinned dev dependencies (package.json, package-lock.json)
npm test                          # tests/desktop/*.test.mjs; fails, never skips, when a dependency is missing
npm run test:bin                  # bin/lib/local-review.test.mjs (bin/review and bin/pr)
uvx --with-requirements requirements-dev.txt pytest -q tests
hermes plugins validate .
python3 scripts/docs_sources.py check --docs-dir <snapshot dir>   # every doc quote in PROMPT-DOCS-REVIEW.md
```

The UI flow tests need react, react-dom, jsdom, nanostores, @nanostores/react and esbuild. `package.json` pins them to
the versions Hermes ships and `npm ci` installs them into `node_modules/`; no Hermes install is needed. `npm test` sets
`PROMPT_STUDIO_REQUIRE_DEPS=1`, so a missing dependency fails the run instead of skipping the UI tests (`CI=1` does the
same). A plain `node --test tests/desktop/*.test.mjs` also looks in `PROMPT_STUDIO_NODE_MODULES` and the Hermes install
(`/usr/local/lib/hermes-agent/node_modules`) and skips, with the reason on stderr, when none has them. To change a
version: `npm install --save-exact --save-dev <pkg>@<version>` and commit both `package.json` and `package-lock.json`.
`npm test` caps Node's heap (`--max-old-space-size=1400`); on a shared machine also wrap it with the `systemd-run`
memory cap from `AGENTS.md`. Python test dependencies are in `requirements-dev.txt` (`pip install -r requirements-dev.txt`).

CI (`.github/workflows/ci.yml`, GitHub-hosted `ubuntu-latest`) runs on every pull request and push to `main`: the build
check, `npm test`, `npm run test:bin`, `pytest -q tests` and gitleaks over the commits of the pull request (or the pushed commits on `main`): the checkout
fetches the whole history, but gitleaks (the pinned binary, not gitleaks-action, which would skip commits past the first 30 and merged side branches) scans only that commit range, merges included, so old synthetic test keys in earlier
commits do not fail it. After the push `bin/pr` reads the check runs of the commit it reviewed (`gh api`, polled
every `CHECKS_POLL_SECONDS`, default 10) and merges only when `Build check and Node tests`, `Python tests` and
`gitleaks` all ended in success. It refuses on a failed, cancelled, skipped or neutral one, on a job still running
past `CHECKS_TIMEOUT_SECONDS` (default 1200) and on a job not reported within `CHECKS_REGISTER_SECONDS` (default
180); `gh pr checks` is not used because it exits 0 for cancelled or skipped checks and for a partial set of jobs.
A green run on the PR is the gate; the local Codex review still runs before the push.

The doc snapshots live outside the plugin; see `docs/sources/README.md`.

## i18n

The UI is English-first through the Desktop plugin i18n API: `ctx.i18n.register(bundles)` in `register()`,
`usePluginI18n(id)` in React, `ctx.i18n.t` outside React. Rule: the `en` and `pt` bundles must have exactly the same
keys (the tests check it). Add a key to both in the same change. Generated prompts are not translated: section
headers and rule lines stay English, and the user's text is copied as written.

## Draft recognition languages

The draft recognizers support Portuguese and English only. The keyword regexes live in
`desktop/src/engine-astra.js` (`VERBS`, `UI_*`, `*_NOUN`, `*_ARTIFACT`, `ASK_FIRST`, subagent and
format hints) and `desktop/src/engine-opus.js` and `desktop/src/engine-sonnet.js` (`CATEGORY_RULES`, `DELIVERABLE_RULES`, `*_VERB`,
`QUESTION_START`, `INTERFACE`); both lower-case the draft and strip diacritics first (`fold()` /
`normalize()`), so the Portuguese words are written without accents. The dashboard's
`REQUIRED_LINES` proof words and `_AUTONOMY_HEADERS` in `dashboard/suggest_engine.py` are also
English + Portuguese. Each pattern carries a `Languages:` comment; other languages fall back to defaults.
The first verb in the draft decides the deliverable, and the Opus and Sonnet detection blocks must stay identical:
`tests/desktop/draft-recognition.test.mjs` holds the draft table all three engines must agree on, and fails when
the detection constants drift apart.

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
- F1 shows the full map. Keep the `SHORTCUTS` map in `desktop/src/ui-components.js` (the only place a key is written) and the help strings in `i18n-ui.js` in sync.

| Key | Action |
|---|---|
| F4 | Open Prompt Studio |
| F1 | Shortcut help |
| F3 | Settings (models, session context, language) |
| F5 / Alt+Y | Confirm / use the recommendation |
| F6 / Alt+K | Skip |
| F7 / Alt+L | Use the AI suggestion |
| F8 / Alt+B | Back (or undo the edit) |
| F9 / Alt+G | Generate the prompt |
| F10 / Alt+X | Close |
| Alt+1…9 | Pick option N |
| Alt+Shift+1…9 | Edit option N |
| Alt+S | Ask the AI |
| Alt+N | Another suggestion |
| Alt+D | Discard |
| Alt+M | Improve my text |
| Alt+C | Paste |
| Alt+O / Alt+A / Alt+T | Target model (Opus / Astra / Sonnet) |
| Alt+I | AI mode |
| Alt+V | Version |
| Alt+E | Put in composer to edit |

Either Alt works, except where the right Alt is AltGr. Alt+digits follow the physical number row.

The map above holds the canonical combos (`aria-keyshortcuts`, `data-studio-shortcut`, tests). What the user reads
goes through `displayCombo` in `ui-components.js`: on a Mac `Alt+Shift+1…9` shows as ⌥⇧1…9 and `F4` as fn F4, with the
modifier glyphs from the SDK's `formatModifierToken` when the Desktop exports it (0.21.4+) and a local table otherwise.
The key listener reads an Alt chord on a `Key*`/`Digit*` code even when the event is `key: 'Dead'`, `keyCode: 229` or
`isComposing` (macOS Option dead keys); other composition is ignored. It never handles Enter, Tab, Esc or Ctrl/Super chords.

## Composer access

`composerAdapter` in `desktop/src/ui-locale.js` reads and writes the message field only through the SDK's
`host.composer` (Hermes Desktop 0.21.5+), addressed with `null` (the composer in use): `getDraft` to start,
`setDraft` to empty it, return the draft on Close and place the prompt; F9 uses `submit` for the session the Studio
was opened in. The plugin changes nothing in the app's DOM; its key listener only reads which dialogs, menus and listboxes are
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

- Each fix starts with a failing test. The test is committed together with the fix or before it.
- The commit message names the test that failed first.
- An independent reviewer, who did not write the change, checks each release.
