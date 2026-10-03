# Changelog

Versions come from the commit subjects. Only 1.6.0 and later have git tags (`v1.6.0` ...); 1.1.0 to 1.5.5 were never tagged. `main` may run ahead of the last tag: entries under Unreleased are on `main` but not in a release yet. Newest first.

## Unreleased

### Regression protection

- Tests: an adversarial battery covers model/settings changes, large or malformed contexts, cancellation and provider
  errors, languages and malformed responses, and keyboard/focus races. It runs in the existing Node and Python suites
  without real provider calls; focused commands are in `docs/REGRESSION-TESTS.md`.
- Fix: putting a prompt in the composer or returning a draft on Close no longer overwrites text typed while the SDK
  write is pending. Placement appends to the live draft; text already present is left untouched.
- Fix: a cancelled or superseded suggestion cannot overwrite the cache used by Back or a later opening. Ordinary
  navigation still keeps useful late suggestions without another model call.
- Fix: suggestions and generated prompts arriving behind an open menu or Settings no longer steal keyboard focus.
  Closing Settings restores lost focus without replacing a target already restored by Hermes.
- Fix: composition preserves protected pasted blocks in large baselines, including the REST limit of 250,000
  characters, without sending those blocks to the model. Direct context reads reject malformed session/profile IDs
  before opening the session store, matching the REST validation.
- Fix: malformed non-string text suggestions are rejected instead of becoming a successful empty answer. Literal
  `<think>`, `<thinking>` and `<reasoning>` tags inside valid JSON strings are preserved; external reasoning is not
  treated as the answer. JSON-aware text is not cleaned a second time by the host's destructive extractor; the
  plugin also recognizes the host's other reasoning markers, including CJK tags, outside the JSON answer.
- Fix: a terminal provider error mentioning `response_format` no longer triggers a JSON-mode retry and a second
  provider call. Genuine JSON-mode incompatibility still gets its bounded fallback.

## 1.9.0

### Keyboard and Mac

- Feature: Prompt Studio opens without an F-key. **Ctrl+Shift+E** (**⌘⇧E** on a Mac) is a binding in Hermes Desktop's
  keybinds area, which you can reassign in Desktop's settings; it does what F4 does (and, like F4, nothing behind an open
  dialog, menu, palette or the Studio's Settings). F4 and the command palette entry keep working. Each of F5 to F10 also
  has an Alt+letter twin: Alt+Y accept, Alt+K skip, Alt+L use the AI suggestion, Alt+B back, Alt+G generate, Alt+X close
  (never E, I, N or U, the Option dead keys). Every control prints both keys, the F1 list shows both and screen readers
  announce both. The Studio still never takes Enter, Alt+Enter, Tab, Esc or any Ctrl/Super chord.
- Mac: key caps, tooltips, notices and the F1 list show ⌥ and ⇧ (⌥E, ⌥⇧3) and F-keys as plain F4, F9 and so on;
  `aria-keyshortcuts` keeps the canonical combo (`Alt+E`). The F1 help gains a Mac note and no longer says "use the left
  Alt": either Alt works, only an AltGr does not.
- Fix: on a Mac, ⌥E (put in composer), ⌥N (another suggestion) and ⌥I (AI mode) did nothing, because macOS reports them as
  dead keys and the key listener dropped those events. An Alt chord on a letter or digit is now read by its physical key; a
  real input-method composition is still ignored.
- Fix: behind the Settings dialog, a model menu, the command palette or any other open dialog, menu or listbox, the
  Studio's keys no longer reach the controls behind it: F9 does not generate, F10 does not cancel, F4 does not open,
  the Alt chords do nothing. F5 to F10 are still swallowed while the Studio is open (no page reload). F1 and F3 do nothing
  either behind a foreign overlay; with the Studio's own Settings open, F1 still works and F3 closes Settings. A dialog
  hidden with CSS does not block the keys.
- Fix: Cancel, Put in composer to edit and Send now left the Settings dialog open when it was open, so it came back over
  the next opening. All of them, and a plugin reload, now close it with the Studio.

### Accessibility

- Feature: the target and AI-mode switches are named groups of pressed/not-pressed buttons (`aria-pressed`), not radio
  groups: every option stays in the tab order and changes only on Enter, Space or a click, so an arrow key never re-asks the
  steps or starts model calls. A ladder edit button is named with its question and current answer ("Edit answer 3: …
  (current answer: …)", also in Portuguese). The preview is a named region and its text has a name. Step, AI-status,
  session-context and preview announcements go through live regions mounted empty and filled afterwards, so a screen reader
  reads them (before, a region that appeared with its text stayed silent). A test requires an accessible name on every
  tabbable element of each Studio screen.

- Fix: in Auto mode on a new session, the option buttons of the first step no longer show for an instant after F4 and
  then vanish when the AI starts thinking. The step shows the "asking the AI" row (with Stop) from its first frame, so the
  options appear once, when the AI has answered, failed or been stopped. Text steps no longer flash their buttons either;
  On request and Off are unchanged.

### Prompts and draft recognition

- New target: **Claude Sonnet 5.5** (Alt+T, or pick **Sonnet**), next to Opus and Astra, with its own prompt engine,
  question help and AI writer rules from Anthropic's Sonnet 5.5 prompting guide. It is the default when the session's model
  is a Sonnet. Opus and Astra prompts did not change.
- Feature: the generated prompts read better on every target. Opus and Sonnet put each rule of the subagent team on its own
  line, as Astra does. On Opus, a done-criterion you wrote is followed only by the line asking for evidence, no longer by
  a generic "done when the behavior works". Astra leaves out the plain-language and style lines and the `DONE WHEN` line
  for a plain answer, so a trivial question gives the same short prompt as on Opus, and wraps examples in `<example>` tags
  like the other targets. Pasted text that contains `<` or `&` carries one line saying that `&lt;` and `&amp;` stand for
  them. The subagents recommendation is now "The model decides" everywhere (the engines, the AI suggestion, the docs); a
  team only when you pick it or the draft asks for one. One prompt snapshot per target locks the wording.
- Fix: the "What do you want to get at the end?" step is always asked and always lists all nine deliverables. Before, a
  draft the engine had misread (a how-it-works question as an executed workflow, "Create a plan for the product launch" as
  an implementation) hid the right option, so the guess could not be corrected. A choice that contradicts the draft's
  verb is kept: the prompt is built for it and the preview says so, in the Studio's language, on both versions.
- Fix: the three engines now read the same draft the same way, and common drafts are read as the deliverable they ask for.
  Unit tests, SQL queries, regexes, READMEs and Dockerfiles are code; "Create a plan" is a plan and "Crie uma planilha" is
  data; the first verb in the draft decides ("Build a review dashboard" is a build); Portuguese *gerar, montar, resumir,
  configurar, instalar* are recognised; `cron` and `rest` no longer force workflow or code; marketing copy is text (the Studio
  asks for examples, not design patterns); reports, summaries and emails stay text even when they mention tests; a question
  ("Como instalar o Docker?", "How do I configure nginx. Be brief.") stays a question; a negated verb ("Do not execute any
  commands") is a prohibition, not the order; and a very long draft no longer freezes the Studio. Astra also reads the
  requirements, trims and lower-cases the deliverable and accepts Windows line endings.
- Fix: "Me diga um plano para configurar o nginx" is a plan, as "Tell me a plan to configure nginx" is, and "Do a code
  review of the API" is a review on Astra too.
- Change: a "show me" request is read as a request for an answer. "Show me a script that extracts data", "Give me a
  function that parses dates", "Me mostre um script" and "Você pode me mostrar uma função?" ask for information whatever
  the artifact is, and a question or an explanation after it changes nothing. The draft becomes a code task only with an
  order to the assistant: a build verb ("Write ...", "Crie ..."), also in a later sentence, after "and" ("... and fix the
  login bug") or addressed after a comma ("..., please write unit tests"). What the script helps someone do ("helps users
  read and write files") stays part of the answer. Known limits: a verb joined by "and" after a purpose ("Give me a script
  to configure nginx and write tests") stays an answer, and a second "and" after what a script helps someone do ("helps
  users read files and write logs and create reports") is read as a task; the Deliverable step changes either with one
  click.
- Fix: the Sonnet 5.5 rule that asks for a real check before reporting code changes as done no longer contains the word
  "sudo" (it says "never with elevated privileges or the system package manager"), so `hermes plugins validate` shows no
  `sudo_usage` caution.

### AI calls and errors

- Feature: a provider failure says what happened. A wrong or expired API key (401) is `auth_failed`, a model or plan the
  provider refuses (403) stays `provider_refused` (its text no longer mentions the key), a rate limit (429) is
  `rate_limited` and a provider call that timed out on its own (client timeout, 408, 504) is `provider_timeout`; a 429 that
  names billing is still `provider_payment`. Each has its own English and Portuguese text in the suggestion and prompt
  tooltips and in the session-context note. One classifier decides the code for /suggest, /compose and /context. See
  docs/CONTRACT.md.
- Fix: when a Hermes update changes something the backend relies on, /suggest, /compose and /context answer the new code
  `host_incompatible` (the Studio tells you, in English or Portuguese, to update the plugin) and /health reports it, instead
  of a generic "unavailable" or a `TypeError` in the log. Every Hermes call now goes through one module,
  `dashboard/hermes_host.py`, which checks the signature it is about to use; a test checks the same signatures against the
  installed Hermes, and a scan test keeps every other file off Hermes.
- Fix: **Improve my text** no longer sends only the first 1,200 characters of a longer answer and replaces your text with
  a rewrite of that fragment: an answer over the limit shows "Your text is too long to improve" (`code: too_long`). Any
  other cut the backend makes to your text is reported with `truncated: true` in the /suggest and /compose response;
  docs/CONTRACT.md lists the effective limit of each field.
- Fix: a reply with no answer text and JSON only inside the model's thinking, or a thinking block cut off by the token limit,
  no longer becomes the suggestion: it is an empty reply (retried once, unless it ended on the token limit). A reply made of
  several parts keeps only the text parts. On choice steps an AI value that is not exactly one of the options ("Not
  applicable here" with Yes/No) is reported as an unlisted option instead of being mapped onto "No".
- Fix: "Could not use the AI this time" on every step when Hermes hosts more than one profile (`UnscopedSecretError` in
  `agent.log`). Each model call now keeps the profile of the request that asked for it.
- Fix: questions and suggestions stopped loading after picking, in Settings, a model whose route refuses JSON mode (for
  example the Claude subscription provider). The Studio now retries that call once without JSON mode.
- Fix: the session summary for the optional session context now goes through the same secret redactor as the transcript
  before it is returned. Answers and field texts on single lines of the suggestion prompt have their line breaks
  collapsed, so an answer cannot pose as a new section.
- Fix: the backend loaded its engine, adapter and context modules again on every request, so the worker caps of
  suggest (6), compose (3) and context (2) never held. They now load once per process (reloaded when a file's mtime changes,
  or on every request with `PROMPT_STUDIO_DEV_RELOAD=1`).

### Install and remote

- New: `scripts/push-desktop.sh user@app-machine` copies `desktop/plugin.js` to the app machine's
  `desktop-plugins/prompt-studio/plugin.js` over one `ssh` call, for a Hermes backend that runs on another machine
  (`--dir` for another desktop-plugins folder, `--dry-run` to see the plan). It says `[OK]` only after the app machine's
  `cksum` of the installed file equals the source's, and refuses a target where `plugin.js` is a directory. A folder that
  Hermes Desktop manages for a local install (it holds `.hermes-package.json`; Desktop would overwrite or delete the pushed
  file on its next rescan) is refused with the way out: `--replace-managed` removes the marker and makes it a standalone
  plugin, after you close Hermes Desktop; it is still refused when the local install's `desktop/plugin.js` is
  byte-identical (Desktop would adopt the folder again), and it reports (not `[OK]`) a folder Desktop deleted or re-marked a
  second later. README, `install.sh` and docs/REMOTE-INSTALL.md now agree, checked against Hermes Desktop's sources:
  Desktop copies the desktop half only from the plugins folder of the Hermes home on the machine where the app runs and
  never fetches it from a remote backend.
- Fix: `./install.sh` run from inside the installed plugin folder (the layout `hermes plugins install` leaves) deleted the
  plugin it was installing. It now sees that source and destination are the same, skips the copy and keeps every file.
  Any other install is staged in a sibling folder and swapped in with `mv`, so a failed copy leaves the previous install
  intact; if an earlier run was killed between the two `mv`, the next run restores `plugins/prompt-studio.old` first.

### Documentation

- Docs: the README lists macOS as tested (Hermes Desktop on a MacBook Pro, 1.9.0 checked by the maintainer).
- Docs: the README is now for users (200 lines at most), with the keyboard table per platform generated from the shortcut
  map (`node scripts/build.mjs` writes it, `--check` fails when it is stale). Contributor material moved to
  `CONTRIBUTING.md` and `docs/DESKTOP-DEV.md`; configuration, model and remote-install details to `docs/CONFIGURATION.md`,
  `docs/MODELS.md` and `docs/REMOTE-INSTALL.md`; six ADRs in `docs/adr/` record the standing decisions and `CONTEXT.md`
  is the glossary. For 1.9.0 the README, docs and CONTRIBUTING were checked line by line against the code.

### Internal

- Development: the dev dependencies are declared and pinned (`package.json`, `package-lock.json`, `requirements-dev.txt`), so
  `npm ci && npm test` runs the UI tests without a Hermes install, and a missing dependency fails the run instead of
  skipping. A GitHub Actions workflow runs the build check, the Node tests, the Python tests and gitleaks on every pull
  request and push to `main`, and `bin/pr` merges only when all three jobs succeeded on the reviewed commit. The build
  reads the sources with `acorn` (a pinned dev dependency: run `npm ci` before the first build) instead of a hand-written
  reader, so a `/` is never guessed to be a division or a regex; it also fails clearly on a missing output and checks name
  collisions across all UI files.
- Internal: `bin/pr` and `bin/review` work outside the maintainer's machine: the base branch comes from the repository
  (`BASE_BRANCH` overrides it), the local review verdict goes into the PR body, a hung Codex run stops after
  `CODEX_TIMEOUT_SECONDS` (default 900) and never approves, an interrupted review stops its Codex process group and never
  approves, and updating the review section of a PR description never deletes handwritten text. The review copy links the
  checkout's `node_modules`, so the build check runs there.
- Internal: the Desktop code is easier to change. One target registry (`TARGETS` in `studio-core.js`) feeds the core, the UI,
  the build and the palette; draft detection lives once in `desktop/src/detection-core.js` as data, and the engines pass
  only the rule lines in which they differ; the UI is split into modules named after their content, with one `lifecycle`
  state object and one `closeStudio`; the shortcut map is one object that also generates the README table; the three timing
  seams of the UI tests are fields of one documented `globalThis.__promptStudioTest`.
- Internal: dead code removed (the Hermes < 0.20 branch of `register()`, the local `ListRow`/`ToggleRow` fallbacks, an
  unreachable context state, unused i18n keys); two action functions renamed so they no longer look like hooks;
  docs/CONTRACT.md and the code agree field by field (a test checks it), and Python functions stay at McCabe complexity 10 or
  less.
- Internal: the CHANGELOG no longer carries internal audit codes, `.gitignore` covers only this project, and generated files
  are marked `linguist-generated`.

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

- Repository prepared for publishing: README rewritten, this CHANGELOG, workflow note in `docs/DESKTOP-DEV.md`.
- The suggest and compose system prompts are written one rule per source line (the text sent to the model is unchanged).
- Each draft-recognition pattern now documents that it covers Portuguese (accents folded) and English.
- Curated README images may live in `docs/images/`; images anywhere else stay ignored by git.
- No behavior change.

## 1.5.3

- Default reasoning effort is `low` when neither `auxiliary.prompt_studio` nor the Settings pick sets one (Opus 5.5 docs).
- A small `max_tokens` is raised at medium/high+ effort, since thinking and text share it.
- A gitleaks scan of the full git history was run.
- Normal-case wording in the suggest and compose system prompts (less aggressive emphasis).
- Astra's plain-language line now also applies to implementation, review and workflow requests.
- `_default_llm` was simplified to stay under the project's complexity limit (10).

## 1.5.2

- Documented that escaping `&` and `<` is the protection against pasted text that imitates the `<pasted_content>` tags.
- The read-only installer tests share one default install.
- `_json_object`, `build_messages` and `parse_yaml_mapping` were simplified to stay under the complexity limit (10), with characterization tests.
- One more prompt-wording point was reviewed and left unchanged.

## 1.5.1

- Import fallbacks re-raise with `from None` (clean under ruff's B904 rule).
- An empty reply that ended because of `finish_reason: length` is no longer retried (the same cap would end the same way); a `content_filter` empty reply is still retried once.
- The Astra writer no longer says "merge them" next to "keep doc lines word for word"; a test proves the Astra prompt repeats no sentence.
- README and `docs/DESKTOP-DEV.md` say what the UI flow tests need and that `CI=1` fails without it.
- The `*secret*` and `*credential*` ignore patterns keep hiding data files but no longer hide `.py`, `.js` and `.mjs` code.
- UI tests fail loudly on missing dependencies under CI and wait for outcomes.
- The hand-written `desktop/plugin.js` was split into `desktop/src`; the build generates the whole `plugin.js` (no behavior change).

## 1.5.0

- Settings dialog (F3) with helper and context model pickers, read-context switch and Studio language.
- Session-context read on F4 feeding Auto suggestions; new `POST /context` (read-only session summary).
- Per-task `model_choice`; `session_context` on `/suggest`.
- `model_not_found` error code; `/suggest` and `/compose` carry the Studio language.

## 1.4.0

- Error codes with localized tooltips, no provider text, forged third-party spans stripped, debounced auto suggestions, AI-off drops late replies.
- Keep tags and headers the user wrote; strip only framing the model invented.
- More tests for `docs_sources` and the `llm_adapter` provider branches.

## 1.3.0

- Astra: subagent default auto, full doc paragraphs, guided order, lighter answer/text, JSON without prose lines, honest review rows.
- Astra auto delegation rule for the same hands-on deliverables as Opus (not plan).
- Opus: explore line only for workflow/data requests; the TIME_LINE caveat is documented; compose keeps SUBAGENTS lines as-is.

## 1.2.0

- Compose keeps its 45 s provider budget; installer timeout 20 and argument validation; tagged suggest blocks with robust escaping; request size limits; broader secret ignores.
- Opus subagents default to auto with the guide's delegation rule; design line only for new interface work.
- Astra frontend guidance and full approval paragraph; frontend lines only for building or changing an interface.

## 1.1.1

- Retry an empty model reply once within the same deadline; report it as no answer ("The model did not answer"), not as a connection error. Anthropic's safety filter can end a reply with no text (`finish_reason: content_filter`).

## 1.1.0

- First commit: standalone Hermes plugin that builds prompts for Claude Opus 5.5 and GPT-6 Astra step by step in the Hermes Desktop composer. Idea credited in README (Credits) and LICENSE.
