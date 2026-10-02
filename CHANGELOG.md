# Changelog

Versions come from the commit subjects; releases from 1.6.0 on are also git tags. Newest first.

## Unreleased

- Fix: a reply with no answer text and JSON only inside the model's thinking no longer becomes the suggestion; it is
  treated as an empty reply (retried once, unless it ended on the token limit). On choice steps an AI value that is
  not exactly one of the options (for example "Not applicable here" with options Yes/No) is now reported as an
  unlisted option instead of being mapped onto "No". Exact matches (any case) and a value that is the start of one
  option ("Y" for "Yes") are still accepted.
- Fix: a thinking block the model never closed (cut off by the token limit) no longer leaks its JSON into the
  suggestion, and a reply made of several parts keeps only the text parts, never the thinking parts. Both are
  treated as an empty reply.
- Fix: `./install.sh` run from inside the installed plugin folder (the layout `hermes plugins install` leaves) deleted
  the plugin it was installing. It now sees that source and destination are the same, skips the copy with a message
  and keeps every file. Any other install is staged in a sibling folder and swapped in with `mv`, so a copy that
  fails leaves the previous install intact.
  If an earlier run was killed between the two `mv`, the next run restores the previous install from
  `plugins/prompt-studio.old` before doing anything else, so a retry that fails no longer loses it.
- Fix: the session summary the model writes for the optional chat-session context now goes through the same secret
  redactor as the transcript before it is returned (and so before it reaches the suggestions). Answers and field texts
  placed on single lines of the suggestion prompt have their line breaks collapsed, so an answer cannot pose as a new
  section such as `Field to fill:`.
- Fix: **Improve my text** no longer sends only the first 1,200 characters of a longer answer to the AI and then
  replaces your text with a rewrite of that fragment. An answer over the limit now shows "Your text is too long to
  improve" (backend `code: too_long`, en/pt). Any other cut the backend makes to your text (a draft over 6,000
  characters, an answer over 3,000, an earlier answer or default text over 600, a baseline over 30,000, or a model
  reply cut to its limit) is reported with `truncated: true` in the /suggest and /compose response, and `docs/CONTRACT.md` lists the effective limit of each field.
- Internal/perf: the backend now loads the engine, adapter and context modules once per process (reloaded only when a
  file's mtime changes, or on every request with `PROMPT_STUDIO_DEV_RELOAD=1`). Before, the dashboard's by-path load
  re-ran them on every request, creating new thread pools each time, so the suggest (6), compose (3) and context (2)
  worker caps and the suggest/compose separation did not hold. A reload also skips the cached bytecode, so an edit
  of the same size within the same second runs the new code.
- Fix: the "What do you want to get at the end?" step is now always asked and always lists all nine deliverables
  for Opus, Sonnet and Astra. Before, a draft the engine had misread (for example "Como funciona o cron do Linux?"
  as an executed workflow, or "Create a plan for the product launch" as an implementation) hid the right option,
  so the guess could not be corrected. A choice that contradicts the draft's verb is kept: the prompt is built for
  it (the prompt's TASK names the chosen deliverable, so a custom success criterion cannot erase the choice) and
  the preview says so in the Studio's language (following a language switch), on both versions (with or without
  AI). The visual-design step and rules follow the chosen deliverable: an answer or plan about an app no longer
  gets them, in the prompt or in what the AI writer receives.
- Fix: common drafts are read the same way on Opus, Sonnet and Astra. Unit tests, SQL queries, regexes, READMEs and
  Dockerfiles are code; "Create a plan" is a plan and "Crie uma planilha" is data (Astra now has the data
  deliverable); the first verb in the draft decides ("Build a review dashboard" is a build); `cron` and `rest` no
  longer force workflow or code; "email me" is a verb, not a text; Portuguese *gerar, montar, resumir,
  configurar, instalar* are recognised. Astra also reads the requirements, trims and lower-cases the deliverable
  and accepts Windows line endings. Marketing copy ("Write the copy for the landing page", "Redija a descrição do
  app") is text: the Studio asks for examples, not design patterns. "Write a review of the API" is a review, not
  code; "Write a plan summary" or "a strategy memo" is text, since the summary or memo is what is asked for.
  Context before the verb does not name its object ("For our app, write a blog post" is text), and a question
  closed by a period ("How to create an app.") stays an answer. A code word that only modifies the text asked for
  ("Write an API announcement email") is not the artifact; a noun before the order ("Our plan is ready. Build a
  dashboard") is context, while "Plan the steps ..." or "Please plan ..." opening a sentence is the order; a context noun no longer
  hides a later verb of the same kind ("The CSV is attached. Extract the totals" is data); an order after an
  opening question ("How does it work? Fix the login bug.") is the task. "Write an email announcing the app" is
  text (a participle opens a clause, not a modifier), and "Como instalar o Node.js?" or "nginx 1.26?" stays a question.
  "Can you plan the steps ..." and "so plan the rollout" keep the planning verb; a negated verb ("Do not execute
  any commands") is a prohibition, not the order; and only the verb that fired can make a request code
  ("Analyze this script, then write a post" stays an analysis). A second question is still a question, a reminder
  ("Don't forget to review the API") still asks for the review, and a very long draft no longer freezes the Studio
  while it is read. "Explain how to configure nginx" is an answer on every engine, "We need to plan before we
  configure" keeps the plan, and a question that wraps onto the next line or carries a comma is still a question.
  "Do not build or deploy anything" forbids both verbs, and the Astra prompt states the chosen deliverable from
  the same reading of goal and requirements as the analysis. Documentation about code ("Write instructions for
  running the unit tests") is text, and a yes/no question ("Can I configure nginx?") is a question, while "Can you
  configure nginx?" stays a request. A question closed by a period and followed by a note ("How do I configure
  nginx. Be brief.") is still a question, and a draft with a long run of spaces no longer freezes the Studio.
- Fix: *Gere um e-mail*, *Monte uma mensagem* and the like stay text, reports and summaries are text even when they
  mention tests ("Write a summary of the test results", "Escreva um relatório dos testes"), and a question such as
  "Como instalar o Docker?" or "Como resumir um livro?" stays an answer on Opus, Sonnet and Astra.
- New target: **Claude Sonnet 5.5** (Alt+T, or pick **Sonnet**), next to Opus and Astra. It has its own prompt engine,
  question help and AI writer rules from Anthropic's Sonnet 5.5 prompting guide, and is the default when the
  session's model is a Sonnet. Opus and Astra prompts do not change.
- Fix: "Não foi possível usar a IA agora" / "Could not use the AI this time" on every step when Hermes hosts more
  than one profile (the dashboard then refuses credential reads with no profile bound, `UnscopedSecretError` in
  `agent.log`). Each model call now keeps the profile of the request that asked for it.
- Fix: questions and suggestions stopped loading after picking, in Settings, a model whose route refuses JSON mode
  (for example the Claude subscription provider, `Only json_schema structured output is supported` in `agent.log`).
  The Studio now retries that call once without JSON mode and reads the JSON from the reply text.

## 1.8.0

- Desktop: the message field is read and written only through the SDK's `host.composer`; the plugin no longer
  reads or changes the app's DOM (catalog rule 8). This needs Hermes Desktop 0.21.5 or newer, so
  `requires_hermes` is now `>=0.21.5`; on an older Desktop the Studio does not open and asks you to update Hermes.
- Attachments are no longer copied by the plugin (the SDK has no attachment API): they stay in the message field.
  **Put in composer to edit** keeps them with the prompt; **Send now** sends only the text, and the preview says so
  in red. The README preview screenshot shows that note.
- The draft is never lost while the Studio opens: switching conversations, disabling or reloading the plugin puts
  it back in its own conversation's message field (or the clipboard, or below the current draft, never over it).
- Contributors: `AGENTS.md` now has the agent fire the Hermes `/review` itself and keep fixing the local Codex review
  findings every five minutes until it approves, without the maintainer in the loop.

## 1.7.1

- Desktop: the request deadline and the auto-suggestion delay now use the host-tracked `ctx.setTimeout`, so
  Hermes clears them when the plugin is disabled or reloaded (it falls back to the global timer on hosts without it).
- README screenshots retaken from the current interface (question step, final preview, settings); the banner is now
  a real capture at 1200x600 instead of an illustration with options the Studio does not have.
- README: the SDK check names what was really checked (export lists of 0.20.0 and 0.21.4, a simulated older SDK,
  a real run on 0.21.5); the install prompt appears only in an interactive terminal; F6 and F7 list every case
  they handle; the capabilities note mentions the Desktop composer guard.
- README: why model calls go through the Hermes auxiliary client and not `ctx.llm` yet.

## 1.7.0

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
- The default model timeout in `__init__.py` is 20 s, as `install.sh` and the README already said (it was 15 s).
- Windows: `.gitattributes` keeps LF line endings, so `build --check` no longer reports a stale build after a
  checkout with CRLF conversion; the bash installer tests are skipped on Windows; the README states Windows support
  and no longer calls the repository private.
- Contributors: `AGENTS.md`, `bin/review` and `bin/pr` add a local Codex review before each pull request.

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
