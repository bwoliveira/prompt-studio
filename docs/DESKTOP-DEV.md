# Desktop development

## Layout

| Path | What it is |
|---|---|
| `desktop/src/engine-opus.js` | Claude Opus 5.5 prompt engine. Pure ESM, no imports, no DOM, deterministic. |
| `desktop/src/engine-astra.js` | GPT-6 Astra prompt engine. Same shape and rules. |
| `desktop/src/studio-core.js` | Step flow (questions, recommendations, answers to brief). Imports only the two engines. |
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
node --test tests/desktop/*.test.mjs
uvx --with fastapi --with httpx --with pyyaml pytest -q tests
hermes plugins validate .
python3 scripts/docs_sources.py check --docs-dir <snapshot dir>   # every doc quote in PROMPT-DOCS-REVIEW.md
```

The doc snapshots live outside the plugin; see `docs/sources/README.md`.

## i18n

The UI is English-first through the Desktop plugin i18n API: `ctx.i18n.register(bundles)` in `register()`,
`usePluginI18n(id)` in React, `ctx.i18n.t` outside React. Rule: the `en` and `pt` bundles must have exactly the same
keys (the tests check it). Add a key to both in the same change. Generated prompts are not translated: section
headers and rule lines stay English, and the user's text is copied as written.

## Keyboard

- While the studio is closed, only **F4** is handled (open the studio, and only when the composer is on screen).
- While it is open, a key works only if a visible control prints it. The key is shown on the control, so what is
  shown is what runs. F5-F10 are always swallowed while open (F5 could reload the window).
- Never taken by the key listener: Tab, Enter, Esc, and any Ctrl or Super chord. F-keys with a modifier are ignored.
  The answer textarea stops propagation of its own keys so typing never reaches the composer's handlers.
- Capture phase, so keys work with the cursor in the answer field; IME composition is left alone.
- F1 shows the full map. Keep `SHORTCUT_MAP` in `plugin.js` and the help strings in `i18n-ui.js` in sync.

| Key | Action |
|---|---|
| F4 | Open Prompt Studio |
| F1 | Shortcut help |
| F3 | Settings (models, session context, language) |
| F5 | Confirm / use the recommendation |
| F6 | Skip |
| F7 | Use the AI suggestion |
| F8 | Back (or undo the edit) |
| F9 | Generate the prompt |
| F10 | Close |
| Alt+1…9 | Pick option N |
| Alt+Shift+1…9 | Edit option N |
| Alt+S | Ask the AI |
| Alt+N | Another suggestion |
| Alt+D | Discard |
| Alt+M | Improve my text |
| Alt+C | Paste |
| Alt+O / Alt+A | Target model (Opus / Astra) |
| Alt+I | AI mode |
| Alt+V | Version |

Use the left Alt: on some layouts the right Alt is AltGr. Alt+digits follow the physical number row.

## Composer DOM adapter

`composerAdapter` in `plugin.js` is the only code that touches the app DOM.

| Selector | Use |
| --- | --- |
| `[data-slot="composer-root"]:has([data-slot="composer-surface"])` | live composer root |
| `[data-slot="composer-surface"] [data-slot="composer-rich-input"][role="textbox"]` | rich input: read, write, focus |
| `[data-slot="composer-surface"] textarea:not([aria-hidden])` | visible textarea renderer, if present |
| `[data-slot="composer-attachments"] …` | attachments staged with the draft, kept with the prompt |

## Try it in Hermes Desktop

1. `node scripts/build.mjs`, then copy `desktop/plugin.js` to `desktop-plugins/prompt-studio/plugin.js` under your
   Hermes home (`$HERMES_HOME`, usually `~/.hermes`) and reopen Hermes Desktop. The dashboard backend is installed
   with the plugin (`./install.sh` from this checkout); its REST base is `/api/plugins/prompt-studio`.
2. Type a draft and press F4 (or click **Prompt Studio**): the draft moves into the studio and the composer empties.
3. Each step shows the AI suggestion on its own in automatic mode; confirm, pick an option or skip. **Back**
   restores the previous answer.
4. **Close** puts the original draft back.
5. **Generate**: the prompt lands in the composer with attachments kept; it is not sent.
6. With the backend route failing, **Generate** still places the engine's prompt with a warning.

The AI model used by the studio is the auxiliary task `prompt_studio` in the Hermes config
(`auxiliary.prompt_studio`) unless a model is picked in Settings (F3); picks live in the plugin storage
(`helperModel`, `contextModel`, `readContext`, `language`) and the plugin never edits the config.
