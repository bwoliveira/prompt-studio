# Contributing to Prompt Studio

For coding agents, `AGENTS.md` holds the binding rules; this file is the human entry point. User documentation is in
`README.md`. Deeper notes: `docs/DESKTOP-DEV.md` (Desktop half, keyboard, build), `docs/CONTRACT.md` (REST contract),
`docs/adr/` (why things are the way they are), `CONTEXT.md` (vocabulary).

## Source and build

The source is in `desktop/src/` (engines, studio core, translations, Desktop UI). `desktop/plugin.js` is the single file
Hermes Desktop loads, so the build generates it from those sources, together with `desktop/studio-core.mjs` (the same code
as an ES module, for the Node tests). **Never edit either by hand**: edit `desktop/src/*`, then run the build
([ADR 0005](docs/adr/0005-concatenation-build-with-isolated-engine-scopes.md)).

```bash
node scripts/build.mjs            # inline desktop/src/* into desktop/plugin.js, write desktop/studio-core.mjs and the README keyboard table
node scripts/build.mjs --check    # fails if plugin.js, studio-core.mjs or the README shortcut table is out of date
```

The build parses the sources with `acorn`, a pinned dev dependency, so run `npm ci` once before the first build (Node 22.13 or
later, as `engines` in `package.json` says; CI uses Node 24).

The keyboard table in `README.md` sits between the `shortcut-table` marker comments and is generated from the
`SHORTCUTS` map and the `shortcuts.*` labels of `desktop/src/i18n-ui.js`. Never edit it by hand: change the map or the
label and rebuild. The file that holds the map is named once, as `SHORTCUTS_SOURCE` in `scripts/build.mjs`.

## Tests

```bash
npm ci                            # once: the pinned dev dependencies (package.json, package-lock.json)
npm test                          # UI and engine tests; fails, never skips, when a dependency is missing
npm run test:bin                  # tests of bin/review and bin/pr (bin/lib/local-review.test.mjs)
uvx --with-requirements requirements-dev.txt pytest -q tests
hermes plugins validate .
python3 scripts/docs_sources.py check --docs-dir <snapshot dir>   # every doc quote in PROMPT-DOCS-REVIEW.md
```

- New behavior comes with tests. UI tests never compare jsdom nodes with `assert.equal`/`deepEqual` (a failing diff of
  DOM nodes once used over 8 GB of RAM); use `assert.ok(a === b)`.
- Run the Node tests under a memory cap on a shared machine, for example
  `systemd-run --scope -p MemoryMax=1500M -p MemorySwapMax=0 timeout 280 npm test`. `npm test` also caps Node's heap
  at 1400 MB.
- The UI flow tests (`tests/desktop/studio-flow.test.mjs`) need react, react-dom, jsdom, nanostores,
  @nanostores/react and esbuild. `package.json` pins them (the versions Hermes ships) and `npm ci` installs them, so no
  Hermes install is needed. `npm test` sets `PROMPT_STUDIO_REQUIRE_DEPS=1`: a missing dependency fails the run
  instead of skipping the UI tests (as `CI=1` does). A plain `node --test tests/desktop/*.test.mjs` also looks in
  `PROMPT_STUDIO_NODE_MODULES` and the Hermes install, and skips, with the reason printed, when none has them.
- `tests/desktop/prompt-snapshots.test.mjs` compares each target's prompt for one fixed brief with
  `tests/desktop/fixtures/prompt-snapshots/<target>.txt`. After an intended change of a rule line, run
  `UPDATE_SNAPSHOTS=1 node --test tests/desktop/prompt-snapshots.test.mjs` and read the git diff before committing.
- `tests/desktop/clean-room.test.mjs` needs the official doc snapshots and the third-party builders' checkouts next to this
  repository; it is skipped, with the reason printed, when they are missing.
- To change a pinned version: `npm install --save-exact --save-dev <pkg>@<version>` and commit both `package.json` and
  `package-lock.json`.
- The Python test dependencies are in `requirements-dev.txt` (the plugin itself needs none), for the `uvx` command above
  and for `pip install -r requirements-dev.txt`.
- `tests/test_hermes_host_contract.py` checks the Hermes signatures the backend relies on against the installed Hermes and
  is skipped only where Hermes is not installed; its docstring has the command that runs it with Hermes' own
  interpreter. After a Hermes update, run it: a failure there is what `host_incompatible` reports to users.
- `.gitattributes` keeps every text file with LF line endings, also on Windows checkouts, so
  `node scripts/build.mjs --check` compares the same bytes on every system.
- Python functions stay at McCabe complexity 10 or less. Check with
  `uvx ruff check --select C901 --config 'lint.mccabe.max-complexity=10' .` (it must print "All checks passed!").
  CI does not run it: the repo has no ruff configuration and no lint job, so run it before a pull request.

## Continuous integration and secrets

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `node scripts/build.mjs --check`,
`npm test`, `npm run test:bin`, the Python tests and gitleaks over the commits of the pull request (or the commits of a
push to `main`), not the whole history. `bin/pr` reads the check runs of the commit it reviewed and merges only when all
three jobs (`Build check and Node tests`, `Python tests`, `gitleaks`) ended in success: it waits while one is running
(up to `CHECKS_TIMEOUT_SECONDS`, default 1200) or missing (`CHECKS_REGISTER_SECONDS`, default 180) and refuses on a
failed, cancelled, skipped or neutral one (`gh pr checks` is not used: it exits 0 for cancelled or skipped checks and for
a partial set of jobs). Gitleaks runs as the pinned binary over that commit range, merges included, because
gitleaks-action would skip commits past the first 30 and merged side branches. `.gitleaksignore` lists the only accepted findings, fake secrets in the
redaction tests of one early commit; later test fixtures are marked inline with `gitleaks:allow`.

## Pull requests

`AGENTS.md` has the flow. Work on a branch (`<type>/<subject>`), one subject per pull request, tests first: each fix
starts with a failing test, and the commit message names it (`Failing first: <test file> "<test name>"`). Every
user-visible change gets a line in `CHANGELOG.md` under `## Unreleased`; versions are bumped only when a release is cut (next section).

Both reviews run locally, before the first `bin/pr` of a branch: the Hermes `/review`, then the Codex review
(`bin/review`, run by `bin/pr` with the Codex CLI). With no P0, P1 or P2, `bin/pr` pushes, opens the pull request and
merges it once CI is green. The scripts read the base branch from the repository (`BASE_BRANCH` overrides it), put the
review verdict into the pull request body and stop a Codex run after `CODEX_TIMEOUT_SECONDS` (default 900; a timeout
never approves). Their tests: `node --test bin/lib/local-review.test.mjs`.

## Cutting a release

Only the maintainer decides when. On its own branch (`docs/release-X.Y.Z`): set `version` in `plugin.yaml` and in
`dashboard/manifest.json` (`tests/test_manifest.py` requires them to match; `package.json` carries no version), rename
`## Unreleased` in `CHANGELOG.md` to `## X.Y.Z` and put a fresh empty `## Unreleased` above it, run every suite, and send it
through `bin/pr` like any change. The squashed commit's subject starts `Prompt Studio X.Y.Z:` (the CHANGELOG takes its
versions from commit subjects) and the git tag `vX.Y.Z` goes on that commit once it is merged.

## Hermes plugin guidelines

How the plugin follows the Hermes plugin guide, and where the decision is written down:

- **One package with three parts:** `plugin.yaml` + `__init__.py` (the agent half registers the `prompt_studio`
  auxiliary task), `dashboard/` (REST routes at `/api/plugins/prompt-studio/`) and `desktop/plugin.js` (the Desktop half).
- **SDK only:** the Desktop half imports only `@hermes/plugin-sdk` and `react`, and reads and writes the message field
  only through `host.composer` ([ADR 0003](docs/adr/0003-host-composer-only.md)); it changes nothing in the app's DOM and
  reads no internal stores. The one thing it reads from the page is which dialogs, menus and listboxes are open (their
  ARIA roles and whether they are visible), so that its keys stand back behind them; that depends on the host marking
  its overlays with those roles.
- **Host-tracked resources:** the key listener goes through `ctx.addEventListener`, timers through `ctx.setTimeout`,
  preferences through `ctx.storage`, text through `ctx.i18n`, and colours through theme variables.
- **Declared capabilities match reality:** the agent half declares no tools, hooks, middleware or environment variables;
  the Desktop half adds only a composer guard that blocks a blank send while the Studio is open.
- **Model calls:** the backend delegates provider calls and credential resolution to Hermes's auxiliary client, routed
  by the plugin's own `prompt_studio` task, and sends no sampling parameters
  ([ADR 0001](docs/adr/0001-no-sampling-parameters.md)). It does not use `ctx.llm` yet
  ([ADR 0002](docs/adr/0002-no-ctx-llm-yet.md)).
- **No self-updating code:** updates come only through `hermes plugins update` or a new catalog pin.
- **Installed with the Hermes CLI:** `hermes plugins install bwoliveira/prompt-studio`; `install.sh` changes
  configuration only through `hermes plugins enable` and `hermes config set`.
- **Validation:** `hermes plugins validate .` passes.
- The official doc snapshots used by `docs_sources.py` live outside the repository; see `docs/sources/README.md`.

## Repository layout

```
plugin.yaml, __init__.py   manifest and agent half (registers the prompt_studio auxiliary task)
dashboard/                 backend REST routes, LLM adapter and session-context reader
desktop/                   Desktop half: src/ sources and the generated plugin.js
docs/                      contract, developer notes, ADRs (adr/), remote install, configuration, model notes,
                           step and doc-quote reviews, doc sources
scripts/                   build, install validation, doc-quote check, SDK export lister, push-desktop.sh (remote install)
tests/                     Python tests and tests/desktop/ Node tests
install.sh                 installer for a Hermes home or profile
bin/                       pr and review: local Codex review before each pull request
.github/workflows/ci.yml   CI: build check, Node and Python tests, gitleaks
package.json, requirements-dev.txt   pinned dev dependencies (Node, Python)
AGENTS.md                  rules for coding agents, including the review flow
CONTEXT.md                 glossary of the project's vocabulary
```
