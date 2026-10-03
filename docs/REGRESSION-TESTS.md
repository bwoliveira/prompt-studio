# Adversarial regression tests

These tests exercise the real Studio engines, adapters and UI with a simulated provider, composer SDK and session store.
They do not call a paid model, open a real session database or require credentials. They run in the regular `npm test`
and Python test suites; no separate CI job or live Hermes installation is required.

## Run the battery

Install the pinned dependencies with `npm ci`. Build from `desktop/src/` before testing an edited UI, since the flow
harness loads the generated plugin:

```bash
npm run build
PROMPT_STUDIO_REQUIRE_DEPS=1 NODE_OPTIONS=--max-old-space-size=1400 node --test --test-name-pattern='REG-' tests/desktop/studio-flow.test.mjs
uvx --with-requirements requirements-dev.txt pytest -q tests/test_regression_*.py
```

On a shared Linux host, add a process memory limit to the Node command:

```bash
systemd-run --scope -p MemoryMax=1500M -p MemorySwapMax=0 timeout 280 env PROMPT_STUDIO_REQUIRE_DEPS=1 NODE_OPTIONS=--max-old-space-size=1400 node --test --test-name-pattern='REG-' tests/desktop/studio-flow.test.mjs
```

The name filter selects the new adversarial UI cases. It is not a substitute for the full suites before accepting a
change: run `npm run check`, `npm test`, `npm run test:bin` and `uvx --with-requirements requirements-dev.txt pytest -q tests`.
`CONTRIBUTING.md` describes the memory limit, dependency checks and optional external-fixture tests.

## Coverage by family

| Family | Python tests | UI prefix | Behaviors protected |
|---|---|---|---|
| Models and settings | `tests/test_regression_models.py` | `REG-MODELS:` | Model and effort snapshots across pending requests; helper/context separation; empty and malformed settings; no provider URL or body leakage into a later request; JSON fallback keeps its original model. |
| Large, incomplete or invalid contexts | `tests/test_regression_contexts.py` | — | REST validation before database/provider access; damaged or absent session data; summary bounds and locale fallback; large protected pasted blocks survive composition without being sent to the model; exact session/profile validation on direct calls. |
| Cancellation, slowness and provider errors | `tests/test_regression_provider.py` | `REG-PROVIDER:` | Stop, retry, close/reopen, out-of-order responses and stale cache entries; transport timeout; one permitted JSON-mode fallback; terminal provider errors do not trigger another billable call. |
| Languages and malformed responses | `tests/test_regression_formats.py` | — | Unicode and locale-sensitive envelopes; invalid JSON and top-level shapes; non-string suggestion values; reasoning outside the answer; literal reasoning-like tags inside JSON strings, including fenced JSON. |
| Keyboard, focus and overlapping actions | — | `REG-UI:` | Input-method composition and modifier chords; held keys across Generate/Send; menus and Settings opened while responses are pending; SDK rejection and explicit retry; session/pane binding; typing while prompt placement or draft restoration is pending. |

Changing the helper model does not cancel a request already sent: that request keeps its captured choice, and the next
request uses the new choice. Cancellation, unlike ordinary step navigation, must prevent the cancelled response from
becoming reusable cache data.

The additional `REG-FIX-UI:` cases cover cache ownership across navigation and focus recovery when Settings closes.
They are selected by the same `REG-` filter.

## Adding a regression

- Name the violated behavior, its trigger and its observable result. Use `REG-MODELS:`, `REG-PROVIDER:` or `REG-UI:`
  for a flow case so it is included in the focused command.
- Reuse the flow harness and its fake SDK. Do not duplicate the UI or export production internals just for tests.
- Control asynchronous ordering with deferred promises; use the existing bounded wait helpers only to observe rendered
  state. Release every gate and restore overridden methods in `finally`, even when an assertion fails.
- Assert user-visible text, request payloads, call counts and focus ownership. A mocked transport supplies failures or
  responses; the real plugin decides how to parse, retry, cache and render them.
- Model host helpers' transformations too: the response-extractor double strips paired reasoning tags, including
  pairs inside JSON strings, as Hermes does. An identity double misses destructive second-pass cleanup after the
  plugin's parser. The adapter must preserve literal tags and still reject external reasoning markers.
- Compare DOM nodes with `assert.ok(actual === expected)`, never equality assertions that try to print the whole DOM.
- Verify each defect regression fails on the pre-fix implementation for the expected reason, then passes with the fix.
  Cases that already pass are preservation guards, not evidence that a defect was fixed. Do not hide a reproduced
  failure behind `skip` or `xfail`.

## Limits

The UI suite runs in jsdom. It verifies event handling and focus ownership, not native macOS keyboard delivery, the real
Hermes dialog focus trap, accessibility announcements or visual layout. The fake provider tests verify protocol handling
and controlled races, not a particular provider's current availability or wording. Use live manual checks only when those
host/provider boundaries are the subject of a change, with separate authorization for real model calls.
