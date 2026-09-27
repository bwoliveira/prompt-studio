# Changelog

Versions come from the commit subjects (there are no git tags). Newest first.

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
