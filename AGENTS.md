# Agent rules for Prompt Studio

Guidance for any coding agent working in this repository (Hermes, Claude Code, Codex). Human docs: `README.md`,
`docs/DESKTOP-DEV.md`, `docs/CONTRACT.md`.

## Changes

- Change only what the task needs; no extra features, refactors or new abstractions.
- Never edit the installed Hermes code, official Hermes skills or official plugins. A Hermes problem the plugin
  cannot fix goes into README.md as guidance for the user (what to do to avoid it); no upstream issue unless Bruno
  asks.
- The plugin sends no sampling parameters (temperature, top_p) to the model: Hermes decides them for each model.
- Edit `desktop/src/*`, then `node scripts/build.mjs`; never edit `desktop/plugin.js` or `desktop/studio-core.mjs`.
- New behavior comes with tests. UI tests never compare jsdom nodes with `assert.equal`/`deepEqual` (a failing diff
  of DOM nodes once used over 8 GB of RAM); use `assert.ok(a === b)`. Run the Node tests under a memory cap, for
  example `systemd-run --scope -p MemoryMax=1500M -p MemorySwapMax=0 timeout 280 node --test tests/desktop/*.test.mjs`.
- Every user-visible change goes into `CHANGELOG.md` under `## Unreleased`. Releases are cut only when Bruno decides; do not bump
  versions in feature branches.

## Pull requests

Work on a branch (`<type>/<subject>`), one subject per PR. There is no CI review on GitHub: both reviews run locally.

The agent runs the whole review cycle itself; Bruno is not asked to type `/review` or `/loop` nor to follow the Codex
review. Hermes agents follow the skill `pr-review-autopilot`.

**Before the first `bin/pr` of a branch, two reviews, in this order:**
1. **Hermes `/review`, fired by the agent.** When the implementation is done, tests pass and everything is committed,
   the agent writes a short brief in the session (goal, branch, commits, risk areas) and fires `/review` itself with
   `/root/.hermes/scripts/hermes-slash/hermes-review --focus "<brief>"`, then ends its turn so the review can start.
   If that script reports the session "not live in the dashboard backend", or the agent does not run in a Hermes
   session, the agent runs the same review as a subagent with the brief, this file and the diff, and says so in the PR
   description. Any other error of the script means a wrong call: fix it and fire again. It fixes what
   is well founded (P0, P1 and P2 always, with a test) and records in the PR description what `/review` found and what
   was done.
2. **Local Codex review (`bin/review`).** It runs by itself inside `bin/pr` with the Codex CLI; P0, P1 or P2 block the
   push.

**The agent keeps the Codex review going until it approves.** Once the `/review` fixes are committed, it starts
`bin/pr` in the background with its output in a log file and a loop every five minutes
(`hermes-loop start --every 5m --prompt "<what to check>"`, tick prompt in the skill; a background watcher when the
session is not reachable). Each round it reads the log, fixes every P0, P1 and P2 with a test, commits and runs `bin/pr` again,
until the review reports none and the PR is merged. It stops and asks Bruno only to dismiss a P0 or P1, to contest a
P2 it believes is unfounded, for `bin/pr --skip-review`, or when the same finding comes back a third time.

When the Codex review approves, `bin/pr` pushes, opens the PR and merges it (squash, only the reviewed commit) without
waiting for Bruno. Fixes after `/review` do not repeat it unless Bruno asks; they always go up through `bin/pr`, never
a plain `git push`. `bin/pr --skip-review` only with Bruno's authorization.
