# Local Codex review of Prompt Studio

You are reviewing a change to Prompt Studio, a Hermes plugin: Python backend in `dashboard/`, Desktop UI sources in
`desktop/src/` bundled into `desktop/plugin.js` and `desktop/studio-core.mjs` by `scripts/build.mjs`, installer
`install.sh`, tests in `tests/`. Commit under review: {{HEAD}}. Read the diff with `{{DIFF}}` and open the whole
touched files when you need context. Do not modify anything; your answer follows the output schema.

## Review guidelines

- Read `AGENTS.md` and `README.md` first: their rules and the behavior they promise are part of the review.
- Only point out problems this diff introduces or leaves wrong: bugs, regressions, broken contracts between
  `dashboard/` and `desktop/`, and changes that contradict `docs/CONTRACT.md`. Style preferences are not findings.
- Never let a secret, key, token or personal path reach the repository or a log.
- `desktop/plugin.js` and `desktop/studio-core.mjs` are generated: a change in `desktop/src/` without the rebuilt
  bundle (`node scripts/build.mjs --check`) is a finding.
- Behavior changes need tests. UI tests must not compare jsdom nodes with `assert.equal`/`deepEqual` (a failing
  diff of DOM nodes once used over 8 GB of RAM); `assert.ok(a === b)` is the safe form.
- The plugin does not send sampling parameters (temperature, top_p) to the model; Hermes decides them.
- The installed Hermes code is never edited by this project; a Hermes problem the plugin cannot fix is documented
  in README.md with what the user should do.
- `README.md`, `CHANGELOG.md` (section "Unreleased") and `docs/` must stay true after the change.
- Severity: P0 breaks the plugin or leaks a secret; P1 is a clear bug or a broken requirement; P2 is a real
  problem with a narrower impact (missing test for new behavior, outdated doc that misleads); P3 is minor.
- Each finding: title, file path, line, and the explanation with the evidence. No finding without evidence.
