# Prompt Studio

![Prompt Studio banner: guided prompt builder for Hermes Desktop](docs/images/banner.png)

Prompt Studio is a Hermes Desktop plugin that turns a rough request into a well-built prompt for
**Claude Opus 5.5**, **Claude Sonnet 5.5** or **GPT-6 Astra**. It asks the few questions that change the result, one step at a
time, with a recommended answer on each step. Then it writes the prompt and places it in the message
field for you to review. It never sends anything on its own.

Each step can get a suggestion from a fast auxiliary model, and at the end that model can polish the
prompt from your answers. When the AI is off, slow or unavailable, you still get a complete prompt,
built locally by the plugin's own engine for the chosen model.

The three prompt engines (Opus 5.5, Sonnet 5.5, GPT-6 Astra) were written for this plugin from the official Anthropic and OpenAI documentation.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [Keyboard](#keyboard)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [Built for Claude Opus 5.5, Claude Sonnet 5.5 and GPT-6 Astra](#built-for-claude-opus-55-claude-sonnet-55-and-gpt-6-astra)
- [How it follows the Hermes plugin guidelines](#how-it-follows-the-hermes-plugin-guidelines)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Credits](#credits)
- [License](#license)

## Requirements

- Hermes 0.21.5 or later (`requires_hermes: ">=0.21.5"` in `plugin.yaml`), with Hermes Desktop 0.21.5 or later.
  The Studio reads and writes the message field only through the Desktop SDK's `host.composer`, added in 0.21.5;
  on an older Desktop it does not open and asks you to update Hermes.
- The `hermes` CLI on `PATH`, or its path in `HERMES_BIN`.
- Python 3.12 or later for the installer (set `PYTHON_BIN` to pick an interpreter).
- **Platforms:** tested only on Linux (Linux Mint, with Hermes Desktop). Windows and macOS are not tested.
  On Windows, install with `hermes plugins install` (below): `install.sh` is a bash script, so it and its
  tests do not run on native Windows.

## Install

Install it with the Hermes plugin command, run on the machine where the Hermes backend runs:

```bash
hermes plugins install bwoliveira/prompt-studio --enable
```

Without `--enable`, Hermes asks `Enable 'prompt-studio' now? [y/N]` in an interactive terminal (otherwise the
plugin stays disabled); `--no-enable` installs it disabled.
For a reproducible install, pin a full 40-character commit SHA (tags, branches and short SHAs are not
accepted):

```bash
hermes plugins install bwoliveira/prompt-studio --ref <40-character-commit-sha>
```

Update later with `hermes plugins update prompt-studio`. Then close and reopen Hermes Desktop so the
backend mounts the plugin's routes and Desktop picks up the desktop half from the plugins folder.
**Capabilities → Plugins** should show *Prompt Studio* enabled. (Desktop and backend on different machines:
see *Remote backend* below.)

These commands come from the official plugin guide
([Plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)).

**Remote backend** (Desktop connected over SSH or a URL): run the install on the backend host as above. Hermes
Desktop copies the desktop half only from the plugins folder of the Hermes home on the machine where the app runs;
it never fetches it from a remote backend. So the desktop half has to be put on the app machine. From a
checkout (on the backend host or anywhere with `ssh` access to the app machine), run:

```bash
scripts/push-desktop.sh me@my-laptop                       # user@machine or an ~/.ssh/config alias
scripts/push-desktop.sh me@my-laptop --dir /path/to/desktop-plugins   # when HERMES_HOME is set on that machine
scripts/push-desktop.sh me@my-laptop --replace-managed     # the folder is managed for a local install: see below
scripts/push-desktop.sh me@my-laptop --dry-run             # print the plan, open no connection
```

It copies `desktop/plugin.js` to `<desktop-plugins>/prompt-studio/plugin.js` on the app machine with one `ssh`
call (no `scp`), through a temporary file, so Desktop never reads a half-written file. The app machine compares
a checksum of the temporary file and of the installed `plugin.js` with the source before the script says `[OK]`;
a directory named `plugin.js` is refused. Desktop rescans that folder
every few seconds; if *Prompt Studio* does not appear, close and reopen it. Repeat after each update of the
plugin. The script needs a POSIX login shell on the app machine (Linux, macOS).

If that machine also has Prompt Studio installed locally (`hermes plugins install` there), Desktop manages the
`desktop-plugins/prompt-studio` folder for that install and marks it with `.hermes-package.json`. On its next rescan
Desktop would overwrite a pushed file with the local install's older copy, or delete it once that install is gone, so
the script refuses such a folder and copies nothing. Either remove the local install on the app machine
(`hermes plugins remove prompt-studio`; Desktop then drops its managed copy) and push again, or add
`--replace-managed`, which removes the marker so the folder becomes a standalone plugin that Desktop never
overwrites. Other files in the folder are left alone.

The `desktop-plugins` folder is `<Hermes home>/desktop-plugins`, where the Hermes home on the app machine is
`$HERMES_HOME` when set, else `~/.hermes` on Linux and macOS and `%LOCALAPPDATA%\hermes` on Windows (an existing
`%USERPROFILE%\.hermes` is still used there when the new folder does not exist). On Windows copy the file by hand
to `%LOCALAPPDATA%\hermes\desktop-plugins\prompt-studio\plugin.js`; the script does not support it.

### Install from a checkout

`install.sh` does the same from a local clone, and can target a profile or another Hermes home:

```bash
git clone https://github.com/bwoliveira/prompt-studio.git
cd prompt-studio
./install.sh                    # default Hermes home ($HERMES_HOME or ~/.hermes)
./install.sh --profile <name>   # or a named profile
./install.sh --home <path>      # or a custom Hermes home (absolute path)
```

`--home` and `--profile` cannot be used together. The script checks the manifest and the Hermes version,
copies the package (with its desktop half) into `plugins/prompt-studio/`, and changes configuration only
through the `hermes` CLI (`hermes plugins enable`, `hermes config set`). It is safe to re-run; run it again
after `git pull` to update. Run from inside the installed folder itself (where `hermes plugins install` puts
it), it skips the copy, says so, and only registers the plugin; a copy that fails midway leaves the previous
install as it was.

## Usage

![Prompt Studio step with option cards, the AI-recommended choice and its reason, and a key on every control](docs/images/step-question.png)

1. Write your request in the message field and press **F4**, or click **✨ Prompt Studio**, or run
   *Prompt Studio* from the command palette.
2. Pick the model (**Opus**, **Astra** or **Sonnet**). The first default follows the session's model.
3. Answer the steps. Depending on the request, they are:
   - what you want to receive
   - reference text to paste, and where it came from
   - context
   - rules that cannot be broken
   - how you will know it is done
   - interface patterns to avoid (Opus and Sonnet, code work)
   - autonomy
   - subagents
   - an example of the result
   - format
   - length

   Every step has a recommended choice. You can skip, go back, or edit any earlier answer.
4. Generate. The preview shows the prompt; switch between the AI version and the version built without AI,
   then **Send now** (F9) to send it at once, or **Put in composer to edit** (Alt+E) to place it in the message field and edit it first.

![The final prompt preview with the AI-written prompt, the Send now (F9), Put in composer to edit (Alt+E), See the version without AI, Back to steps and Cancel buttons, and the red note that attachments do not go with Send now](docs/images/step-preview.png)

The AI mode (Auto, On request, Off) decides when step suggestions are requested.

### Language

The interface is in English and uses the Hermes Desktop plugin translation API (`ctx.i18n`). A
Brazilian Portuguese bundle ships with the plugin. By default the Studio follows the Hermes language; Settings
(F3) can fix it to Português or English, which also sets the language of the questions and of the AI's notes.
The prompt itself follows the language of your request.

## Keyboard

Every control shows its key next to its label. Keys work with the cursor in the answer field.

| Key | Action |
|---|---|
| F4 | Open Prompt Studio (from the message field) |
| F1 | Show or hide the list of shortcuts |
| F3 | Settings: models, session context, language |
| F5 | Accept the recommended choice, or confirm what you typed |
| F6 | Skip, I don't have one, or use the default |
| F7 | Use the AI suggestion (text goes into the field for F5 to confirm; if the AI offers the default, F7 accepts it) |
| F8 | Back / undo the edit / back to the steps |
| F9 | Generate the prompt; on the preview, send it now |
| F10 | Close and return the draft |
| Alt+1 … Alt+9 | Pick an option |
| Alt+Shift+1 … Alt+Shift+9 | Edit an answered step |
| Alt+S | Ask the AI, or try again |
| Alt+N | Another suggestion |
| Alt+D | Discard the suggestion, or stop the AI |
| Alt+M | Improve my text |
| Alt+C | Paste text |
| Alt+O / Alt+A / Alt+T | Write for Opus / Astra / Sonnet |
| Alt+I | Next AI mode (Auto, On request, Off) |
| Alt+V | Other version in the preview |
| Alt+E | Put the prompt in the composer to edit before sending |

Keys and scope:

- **Studio closed:** only F4 is used, and only from the message field.
- **Never captured:** the studio's key listener never takes Tab, Enter, Esc or chords with Ctrl or Super.
  Inside the studio's own answer field, keys stay in that field (Enter makes a new line), so typing an
  answer never triggers the app's composer.
- **Alt:** either Alt key works, except where the right Alt is AltGr (some layouts), which does not trigger the
  shortcuts. Alt+digits follow the physical number row, whatever the keyboard layout.
- **Apple keyboards:** press fn with the F-keys (F4 is fn+F4) unless *Use F1, F2, etc. keys as standard
  function keys* is on in macOS Keyboard settings. Alt is the Option (⌥) key. On a Mac the key caps and the F1
  list show ⌥E, ⇧ and "fn F4" instead of Alt+E, Shift and F4. Alt shortcuts follow the physical key, so ⌥E,
  ⌥N and ⌥I still work although macOS would start an accent (a dead key) there; a real input-method
  composition, with no Alt chord, is still left alone.
- **Conflicts checked:** these keys were checked against Hermes Desktop's own bindings and the Linux Mint
  (Cinnamon) desktop, which uses only Alt with the F-keys.

## Configuration

Nothing to set up: with no model picked, the Studio uses your Hermes default model for the questions and for
reading the session context.

### Settings (F3)

Open **Settings** (the gear in the Studio, or F3) to pick:

- one model for the questions and the final polish;
- one model for reading the session context (a fast model keeps F4 quick);
- whether to read this session's context when opening;
- the Studio language.

![Prompt Studio settings opened with F3: questions model, context model, reading context on open, and language](docs/images/step-settings.png)

Each model pick has its provider, model and reasoning level. The picks live in the plugin storage; the
plugin never edits `config.yaml`.

### Auxiliary task `auxiliary.prompt_studio`

Without a pick, the suggestions and the final polish use the auxiliary task `prompt_studio`. Pick its model
like any other side model:

- **CLI:** `hermes model` → *Configure auxiliary models* → **Prompt Studio**
- **config.yaml:**

  ```yaml
  auxiliary:
    prompt_studio:
      provider: anthropic
      model: claude-opus-5-5
      reasoning_effort: low
      timeout: 20
  ```

- `timeout` applies to each step's suggestion (it can lower the 20 s step limit); the final polish always
  gets its own 45 s budget. A fast model keeps each step at a few seconds.
- If `prompt_studio` pins no provider or model, the task follows the main model.
- If suggestions fail with "provider refused" (401/403), a billing note (402: no credits or quota) or "rejected
  the request" (400), the provider, plan or route is the cause, not the Studio. The prompt can still be built
  without AI (Off mode).
- **Command Code:**
  - For Claude models use the provider `commandcode-anthropic` (alias `commandcode-claude`), not `commandcode`.
    Hermes sends `commandcode` through chat completions, and a tester saw Command Code answer 400 for Claude
    models there, asking for the `/provider/v1/messages` endpoint.
  - Pick the model explicitly: in Settings (F3), e.g. `claude-opus-5-5` on `commandcode-anthropic`, or with
    `auxiliary.prompt_studio.provider` and `model` in `config.yaml`. The Studio then passes that provider and model
    to Hermes as given.
  - Likely cause of 403 `MODEL_NOT_IN_PLAN` while the main chat works (not yet confirmed on a real account): with
    no model set, Hermes's auxiliary client uses the provider's default auxiliary model
    (`claude-haiku-4-5-20251001` on `commandcode-anthropic`, `deepseek/deepseek-v4-flash` on `commandcode`), and
    a plan without that model refuses it.
- **Default effort:** with no `reasoning_effort` and no level in Settings, the plugin asks for `low`
  (except on Gemini, where thinking stays off).
- **Effort-aware `max_tokens`:** `max_tokens` covers thinking plus text, so at medium effort a smaller cap is
  raised to 4096, and at high effort and above to 8192. A larger cap is kept.

- `hermes config set auxiliary.prompt_studio.<field> …` prints *"not a recognized config key — it was saved
  anyway"*. The warning is harmless: the CLI checks keys against Hermes's built-in list only, which does not
  include auxiliary tasks registered by plugins. The value is saved and the plugin reads it. Add `--force` to skip
  the warning, or edit `config.yaml` directly.

The REST routes and their request and response shapes are in `docs/CONTRACT.md`.

## Troubleshooting

- **F4 does nothing:** F4 is registered by the plugin's own Desktop code, so if that code did not load,
  nothing listens for the key. Open **Capabilities → Plugins** and find Prompt Studio: a red **failed**
  badge means the Desktop half did not load, and the error is shown under it. Hermes Desktop also shows a
  *Plugin "…" failed to load* toast at startup. To fix it, update the plugin (`hermes plugins update prompt-studio`)
  and Hermes to the latest stable release, then reopen Hermes Desktop. Prompt Studio 1.8.0 and later need
  Hermes Desktop 0.21.5 or newer.
- **Attachments:** files attached in the message field stay there while the Studio is open. **Put in composer to
  edit** (Alt+E) keeps them with the prompt; **Send now** (F9) sends only the text, and the preview says so in red.

## Privacy and security

- **Session context is limited and optional.** When F4 opens the Studio in a session that already has a
  conversation, the context model reads its last user and assistant turns (tool output and reasoning are
  left out, secrets are masked) and writes a short summary. The summary only helps the step suggestions;
  it never goes into the final prompt, because the main model already sees that conversation. Nothing is
  read in a new session, with the AI off, or with *Read this session's context when opening* turned off in
  Settings.
- **Pasted text is escaped** so it cannot close its tags, and it is marked as data, not instructions.
- **No secrets stored.** The plugin keeps only its preferences (such as the Settings picks) in the plugin
  storage, declares no environment variables, and never edits `config.yaml`. Provider error text is
  not shown in the UI; errors surface as codes with localized tooltips.
- **Nothing is sent for you.** The finished prompt is placed in the message field; you decide whether to
  send it.

## Built for Claude Opus 5.5, Claude Sonnet 5.5 and GPT-6 Astra

The three models need different prompts, and the engines follow each vendor's guidance:

- **Claude Opus 5.5** (Anthropic, *Prompting Claude Opus 5.5* and the prompting best practices):
  - Pasted material goes in `<pasted_content>` tags with the documented note; long material goes above the task.
  - Autonomy is stated plainly, and "explore first" is added when the request gives little context.
  - Scope stays to what was asked.
  - No "double-check your work" lines: Opus verifies on its own, so the prompt asks for evidence instead,
    such as the commands run and what they returned.
- **GPT-6 Astra** (OpenAI, *Using GPT-6* and *Rethinking skills and prompts for GPT-6 Astra*):
  - The request is stated to take precedence over skills and `AGENTS.md`.
  - An action request is framed as work to finish, not a plan to propose.
  - Only the official testing line is used, without extra verification lines.
  - The plain-writing lines apply to text answers.
  - Pasted material goes last, inside `<document>` tags.
- **Claude Sonnet 5.5** (Anthropic, *Prompting Claude Sonnet 5.5*):
  - Autonomy wording keeps it working through a long task: at low and medium effort it can stop to check in
    before the work is done.
  - Scope stays to what was asked: it tends to add tests, documentation and small supporting files on its own.
  - The prompt never asks it to write out its reasoning in the answer.
- **All three models:**
  - An optional **subagents** step. "Team" splits the task into independent parts that run in parallel,
    and names one reviewer who did not write any of the work and starts from a fresh context.
  - Examples go in `<example>` tags.
  - Pasted text is escaped so it cannot close its tags, and it is marked as data, not instructions.

`docs/PROMPT-DOCS-REVIEW.md` lists every rule line with the quote it comes from.

## How it follows the Hermes plugin guidelines

- **One package with three parts:** `plugin.yaml` + `__init__.py` (the agent half registers the
  `prompt_studio` auxiliary task), `dashboard/` (REST routes at `/api/plugins/prompt-studio/`) and
  `desktop/plugin.js` (the Desktop half).
- **SDK only:** the Desktop half imports only `@hermes/plugin-sdk` and `react`, and reads and writes the message
  field only through `host.composer`; it changes nothing in the app's DOM and reads no internal stores. The one thing it reads from the page is which
  dialogs, menus and listboxes are open (their ARIA roles and whether they are visible), so that its keys stand back
  behind them; that depends on the host marking its overlays with those roles.
- **Host-tracked resources:** the key listener goes through `ctx.addEventListener`, timers through `ctx.setTimeout`,
  preferences through
  `ctx.storage`, text through `ctx.i18n`, and colours through theme variables.
- **Declared capabilities match reality:** the agent half declares no tools, hooks, middleware or environment
  variables; the Desktop half adds only a composer guard that blocks a blank send while the Studio is open.
- **Model calls:** the backend delegates provider calls and credential resolution to Hermes's auxiliary client,
  routed by the plugin's own `prompt_studio` task. Prompt Studio does not ask for API keys or store them in its own
  settings. It does not use `ctx.llm`
  yet: in Hermes 0.21.5 `ctx.llm.complete()` has no reasoning-effort option and denies a per-call `model=` unless
  the operator sets `plugins.entries.prompt-studio.llm.allow_model_override`, so the questions and context models
  chosen in Settings would stop working on a default install.
- **No self-updating code:** updates come only through `hermes plugins update` or a new catalog pin.
- **Installed with the Hermes CLI:** `hermes plugins install bwoliveira/prompt-studio`; `install.sh` changes
  configuration only through `hermes plugins enable` and `hermes config set`.
- **Validation:** `hermes plugins validate .` passes.

## Development

The source is in `desktop/src/` (engines, studio core, translations, Desktop UI). `desktop/plugin.js` is the
single file Hermes Desktop loads, so the build generates it from those sources. Never edit it by hand.

```bash
node scripts/build.mjs            # inline desktop/src/* into desktop/plugin.js
node scripts/build.mjs --check    # fails if plugin.js is out of date
node --test tests/desktop/*.test.mjs
uvx --with fastapi --with httpx --with pyyaml pytest -q tests
hermes plugins validate .
python3 scripts/docs_sources.py check --docs-dir <snapshot dir>   # every doc quote in PROMPT-DOCS-REVIEW.md
```

- The UI flow tests (`tests/desktop/studio-flow.test.mjs`) need react, react-dom, jsdom, nanostores,
  @nanostores/react and esbuild. They are taken from `PROMPT_STUDIO_NODE_MODULES`, the repo's `node_modules`
  or the Hermes install; without them the tests are skipped with the reason printed, and with `CI=1` they
  fail instead.
- The official doc snapshots used by `docs_sources.py` live outside the repository; see `docs/sources/README.md`.
- `.gitattributes` keeps every text file with LF line endings, also on Windows checkouts, so
  `node scripts/build.mjs --check` compares the same bytes on every system.
- Pull requests: `AGENTS.md` has the flow. The agent fires the Hermes `/review` itself, then runs `bin/pr`, which runs
  the local Codex review (`bin/review`, Codex CLI); with no P0, P1 or P2 it pushes, opens the PR and merges it. The agent
  checks every five minutes, fixes the findings and runs `bin/pr` again until it passes. The scripts read the base
  branch from the repository (`BASE_BRANCH` overrides it), put the review verdict into the PR body and stop a Codex run
  after `CODEX_TIMEOUT_SECONDS` (default 900; a timeout never approves). Their tests:
  `node --test bin/lib/local-review.test.mjs`.
- Secret scanning: run `gitleaks` over the full history. `.gitleaksignore` lists the only accepted findings,
  fake secrets in the redaction tests of one early commit; later test fixtures are marked inline with
  `gitleaks:allow`.

More notes: `docs/DESKTOP-DEV.md` (developer notes and workflow), `docs/CONTRACT.md` (REST contract),
`docs/STEPS-REVIEW.md` (the reason for each step), `docs/PROMPT-DOCS-REVIEW.md` (each rule line and its
doc quote). Release history is in `CHANGELOG.md`.

## Repository layout

```
plugin.yaml, __init__.py   manifest and agent half (registers the prompt_studio auxiliary task)
dashboard/                 backend REST routes, LLM adapter and session-context reader
desktop/                   Desktop half: src/ sources and the generated plugin.js
docs/                      contract, developer notes, step and doc-quote reviews, doc sources
scripts/                   build, install validation, doc-quote check, push-desktop.sh (remote install)
tests/                     Python tests and tests/desktop/ Node tests
install.sh                 installer for a Hermes home or profile
bin/                       pr and review: local Codex review before each pull request
AGENTS.md                  rules for coding agents, including the review flow
```

## Credits

The idea for Prompt Studio came from:

- the [grill-tab](https://github.com/thanhan-a17/grill-tab) repository by thanhan-a17, which asks one
  decision at a time and turns the answers into a brief;
- two prompt-builder sites for specific models: a Claude Opus 5.5 prompt builder
  ([dreamy-mudra-cj75.here.now](https://dreamy-mudra-cj75.here.now/)) and a GPT-6 Astra prompt builder
  ([sable-valley-eyrb.here.now](https://sable-valley-eyrb.here.now/), MIT source at
  [Eddienews/astra-prompt-builder](https://github.com/Eddienews/astra-prompt-builder)).

Prompt Studio's prompt engines were written from scratch from the official Anthropic and OpenAI
documentation and contain no code from those sites. Parts of the packaging and backend scaffolding are
derived from grill-tab, so `LICENSE` keeps its MIT copyright notice.

## License

MIT. See `LICENSE`.
