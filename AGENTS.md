# Agent rules for Prompt Studio

Guidance for any coding agent working in this repository (Hermes, Claude Code, Codex). Human docs: `README.md`,
`docs/DESKTOP-DEV.md`, `docs/CONTRACT.md`.

## Changes

- Change only what the task needs; no extra features, refactors or new abstractions.
- Never edit the installed Hermes code, official Hermes skills or official plugins. A Hermes problem goes upstream
  as an issue or PR.
- The plugin sends no sampling parameters (temperature, top_p) to the model: Hermes decides them for each model.
- Edit `desktop/src/*`, then `node scripts/build.mjs`; never edit `desktop/plugin.js` or `desktop/studio-core.mjs`.
- New behavior comes with tests. UI tests never compare jsdom nodes with `assert.equal`/`deepEqual` (a failing diff
  of DOM nodes once used over 8 GB of RAM); use `assert.ok(a === b)`. Run the Node tests under a memory cap, for
  example `systemd-run --scope -p MemoryMax=1500M -p MemorySwapMax=0 timeout 280 node --test tests/desktop/*.test.mjs`.
- Every user-visible change goes into `CHANGELOG.md` under `## Unreleased`. Releases are cut only when Bruno decides; do not bump
  versions in feature branches.

## Pull requests

Work on a branch (`<type>/<subject>`), one subject per PR. There is no CI review on GitHub: both reviews run locally.

**Before the first `bin/pr` of a branch, two reviews, in this order:**
1. **Hermes `/review`.** The agent does not call `/review` itself and does not replace it with a subagent review: when
   the implementation is done, tests pass and everything is committed, **stop and ask Bruno to type `/review`** in the
   session, with a short summary of what to review (goal, branch, commits). Wait for the result, fix what is well
   founded (P0, P1 and P2 always, with a test), and record in the PR description what `/review` found and what was done.
2. **Local Codex review (`bin/review`).** It runs by itself inside `bin/pr` with the Codex CLI; P0, P1 or P2 block the
   push. Fix, commit and run `bin/pr` again.

Fixes after the PR is open do not repeat `/review` unless Bruno asks; they always go up through `bin/pr`, never a
plain `git push`. `bin/pr --skip-review` only with Bruno's authorization. Merging the PR is Bruno's call.
