# Changelog

Versions come from the commit subjects; releases from 1.6.0 on are also git tags. Newest first.

## Unreleased

- The plugin no longer sends a temperature: sampling stays as Hermes configures it for each model
  (Claude Opus 5.5, for example, rejects any non-default temperature).
- A provider that refuses the model (401/403, e.g. 403 `MODEL_NOT_IN_PLAN`) now shows its own
  `provider_refused` message in suggestions, the final prompt and the context read, instead of the
  generic "AI unavailable".
- Billing refusals (402, no credits or quota) and bad requests (400) also get their own messages
  (`provider_payment`, `provider_bad_request`).
- The Desktop half loads again on Hermes 0.20.0 to 0.21.4: it no longer imports `ListRow`/`ToggleRow`
  by name (added to the SDK in 0.21.5) and falls back to its own settings rows when they are missing.
- README: Troubleshooting section for "F4 does nothing" (check Capabilities → Plugins for the failed badge and error,
  then update the plugin and Hermes; 1.6.0 and 1.6.1 need Hermes 0.21.5 on the Desktop).
- README: Apple keyboard notes (fn with F-keys, Alt is Option; Alt shortcuts match the physical key).
- README: the "not a recognized config key" warning for `auxiliary.prompt_studio.*` is harmless; the value is used.

## 1.6.1

- F9 sends only into the session the Studio was opened in. If the focused session changed since
  opening, the prompt is placed in the composer with the short note instead of being sent into the
  other conversation.
- Tests: focus assertions compare DOM nodes with a boolean, so a failing assertion cannot make Node
  format the whole jsdom tree (the cause of the multi-gigabyte test runs).

## 1.6.0

- Final preview has two actions: **Send now** (F9) places the prompt in the composer and sends it,
  as if you pressed Enter; **Put in composer to edit** (Alt+E) places it without sending. If the
  Desktop refuses the send (for example, a turn is still running), the prompt is placed in the
  composer with a short note, so it is never lost.
- While something the options depend on is in progress, those options are hidden: while the session
  context is read only "Reading this session…" and Cancel (F10) show; in Auto mode the option cards
  wait for the step suggestion; while the AI writes the prompt only Cancel and the AI mode remain.
  A failure or timeout releases the options with a short note.
- The existing Settings switch "Read this session's context when opening" is covered by tests: off
  means no context request and no loading state.
- Tests compare DOM nodes with `assert.ok(a === b)`: a failing `assert.equal(node, …)` made node
  build a diff of the whole jsdom tree and use gigabytes of memory.

## 1.5.5

- README: banner and example images (`docs/images/`), install with `hermes plugins install
  bwoliveira/prompt-studio` as documented in the official plugin guide, `install.sh` kept as the
  checkout option. No behaviour change.

## 1.5.4

- Repository prepared for publishing: README rewritten, this CHANGELOG, workflow note in `docs/DESKTOP-DEV.md` (CT-11).
- CT-04: suggest/compose system prompts written one rule per source line (runtime strings byte-identical).
- CT-06: each draft-recognition pattern documents that it covers Portuguese (accents folded) and English.
- GI-3: curated README images may live in `docs/images/`; images elsewhere stay ignored.
- No behavior change.

## 1.5.3

- Default reasoning effort is `low` when neither `auxiliary.prompt_studio` nor the Settings pick sets one (Opus 5.5 docs).
- A small `max_tokens` is raised at medium/high+ effort, since thinking and text share it.
- GI-4: gitleaks scan of the full history.
- OP-8: normal-case wording in the suggest/compose system prompts (less aggressive emphasis).
- AS-10: Astra plain-language line also for implementation, review and workflow requests.
- `_default_llm` kept under C901 complexity 10.

## 1.5.2

- OP-6: documented that escaping `&` and `<` is the mitigation for imitable `<pasted_content>` tags.
- CT-09: read-only installer tests share one default install.
- CT-03: `_json_object`, `build_messages` and `parse_yaml_mapping` brought under C901 10, with characterization tests.
- OP-7 checked, no change.

## 1.5.1

- CT-05, SP-3, AS-9, RD-2, GI-2 (audit P3 batch 1).
- CT-10: UI tests fail loudly on missing dependencies under CI and wait for outcomes.
- CT-02: hand-written `desktop/plugin.js` split into `desktop/src`; the build generates the whole `plugin.js` (no behavior change).

## 1.5.0

- CX-1: Settings dialog (F3) with helper and context model pickers, read-context switch and Studio language.
- CX-1: session-context read on F4 feeding Auto suggestions; new `POST /context` (read-only session summary).
- Per-task `model_choice`; `session_context` on `/suggest`.
- `model_not_found` error code; `/suggest` and `/compose` carry the Studio language.

## 1.4.0

- CT-01, SE-5, SP-2, RG-1: error codes with localized tooltips, no provider text, forged third-party spans stripped, debounced auto suggestions, AI-off drops late replies.
- SE-3: keep tags and headers the user wrote; strip only framing the model invented.
- CT-07, CT-08: coverage for `docs_sources` and `llm_adapter` provider branches.

## 1.3.0

- Astra: subagent default auto, full doc paragraphs, guided order, lighter answer/text, JSON without prose lines, honest review rows (AS-3 to AS-8, AS-11).
- AS-8: Astra auto delegation rule for the same hands-on deliverables as Opus (not plan).
- OP-4: explore line only for workflow/data; OP-5: TIME_LINE caveat documented; compose keeps SUBAGENTS lines as-is.

## 1.2.0

- Compose keeps its 45 s provider budget; installer timeout 20 and argument validation; tagged suggest blocks with robust escaping; request size limits; broader secret ignores (SP-1, RD-1, SE-1, SE-2, SE-4, SE-9, GI-1).
- OP-1/OP-3: Opus subagents default to auto with the guide's delegation rule; design line only for new interface work.
- AS-1/AS-2: Astra frontend guidance and full approval paragraph; frontend lines only for building or changing an interface.

## 1.1.1

- Retry an empty model reply once within the same deadline; report it as no answer ("The model did not answer"), not as a connection error. Anthropic's safety filter can end a reply with no text (`finish_reason: content_filter`).

## 1.1.0

- First commit: standalone Hermes plugin that builds prompts for Claude Opus 5.5 and GPT-6 Astra step by step in the Hermes Desktop composer. Idea credited in README (Credits) and LICENSE.
