# Changelog

Versions come from the commit subjects. Only 1.6.0 and later have git tags (`v1.6.0` ...); 1.1.0 to 1.5.5 were never tagged. `main` may run ahead of the last tag: entries under Unreleased are on `main` but not in a release yet. Newest first.

## Unreleased

- Feature: Prompt Studio opens without an F-key. It adds a binding to Hermes Desktop's keybinds area, **Ctrl+Shift+E**
  (**⌘⇧E** on a Mac), which you can reassign in Desktop's settings; its default is a chord none of Desktop's own
  actions uses, and it runs the same opening as F4 (an empty or short draft and a missing message field are reported
  the same way, and like F4 it does nothing behind an open dialog, menu, palette or the Studio's Settings). F4 and the ⌘K command keep working. Each of F5 to F10 also has an Alt+letter twin so a Mac user
  never needs fn: Alt+Y accept, Alt+K skip, Alt+L use the AI suggestion, Alt+B back, Alt+G generate, Alt+X close
  (never E, I, N or U, the Option dead keys). The control prints both keys, the F1 list shows both, and both are
  announced to screen readers. The studio still never takes Enter, Alt+Enter, Tab, Esc or any Ctrl/Super chord.
  Behind a dialog, menu or palette (or the Studio's Settings) the Alt twins are left to that overlay, so a Mac still
  types ⌥Y, ⌥K, ⌥L, ⌥B, ⌥G and ⌥X there; F5 to F10 themselves stay swallowed while the Studio is open.
- Fix: on a Mac, ⌥E (Put in composer), ⌥N (Another suggestion) and ⌥I (AI mode) did nothing: macOS reports them as
  dead keys (key `Dead`, keyCode 229 or `isComposing`) and the key listener dropped every such event. An Alt chord on
  a letter or digit key is now read by its physical key even then; a real input-method composition without an Alt
  chord is still ignored. The listener still never handles Enter, Tab, Esc or Ctrl/Super chords (now covered by a test).
- Mac key caps: on a Mac the key caps, tooltips, notices and the F1 list show ⌥E, ⇧ and "fn F4" instead of Alt+E,
  Shift and F4 (the modifier glyphs come from the Desktop SDK's `formatModifierToken` when it has one, a local table
  otherwise). Other platforms are unchanged, and `aria-keyshortcuts` keeps the canonical combo. The F1 help gains a Mac
  note (Option, fn) and no longer says "use the left Alt": either Alt works, only an AltGr (right Alt on some
  layouts) does not.
- Fix: with the Settings dialog, a model menu, the command palette or any other open dialog/menu/listbox in front, the
  Studio's keys no longer reach the controls behind it: F9 does not generate, F10 does not cancel, F4 does not open
  the Studio and the Alt chords do nothing. F5-F10 are still swallowed while the Studio is open (no page reload).
  Behind a dialog, menu or palette that is not the Studio's own Settings, F1 and F3 do nothing either (no second
  Settings dialog, no help toggled); with the Studio's own Settings open, F1 (help) still works and F3 closes Settings. A model or language menu opened
  inside Settings counts as an overlay in front (F1 and F3 do nothing behind it), and a dialog, menu or listbox hidden
  through CSS (`display:none`, `visibility:hidden`) does not block the keys. The key listener now reads which dialogs,
  menus and listboxes are open (ARIA roles and visibility; it changes nothing in the app's DOM); README and
  DESKTOP-DEV say so.
- New: `scripts/push-desktop.sh user@app-machine` copies `desktop/plugin.js` to the app machine's
  `desktop-plugins/prompt-studio/plugin.js` over one `ssh` call, for a Hermes backend that runs on another machine
  (`--dir` for another desktop-plugins folder, `--dry-run` to see the plan). A target folder that Hermes Desktop
  manages for a local plugin install (it holds `.hermes-package.json`; Desktop would overwrite the pushed file with
  the local copy, or delete it, on its next rescan) is refused with the way out; `--replace-managed` removes the
  marker and makes it a standalone plugin. A local install whose `desktop/plugin.js` is byte-identical to the pushed file is refused even with
  `--replace-managed` (Desktop would adopt the folder again and delete it with the install); remove that install first. `--replace-managed` puts the new file in place before it removes the marker, so a Desktop rescan in
  between cannot stamp the marker back onto the old file. It re-checks one second later and reports (not `[OK]`) a folder Desktop deleted or re-marked meanwhile;
  README and `--help` say to close Hermes Desktop for the conversion. The script says `[OK]` only after the app machine's `cksum` of the installed `plugin.js` equals the
  source's, and refuses a target where `plugin.js` is a directory. README and `install.sh` now say the same,
  checked against Hermes Desktop's sources: Desktop copies the desktop half only from the plugins folder of the
  Hermes home on the machine where the app runs and never fetches it from a remote backend. The old wording
  ("Desktop copies the desktop half out") held only when app and backend share a machine; the installer's final
  message and the README remote section now give the push step and the per-OS `desktop-plugins` folder.
- Internal/fix: every Hermes call of the backend (model call, task resolution, reasoning effort, secret redactor, session
  store) now goes through one module, `dashboard/hermes_host.py`, which checks the signature it relies on right before
  using it. When a Hermes update changes one, /suggest, /compose and /context answer the new code `host_incompatible`
  (the Studio shows a short sentence, in English or Portuguese, telling you to update the plugin) and /health reports it, instead of failing with a generic
  "unavailable" or a `TypeError` in the log. That includes a Hermes module that no longer imports (moved, removed, a
  missing dependency) and a session store whose `close` now needs an argument. No Hermes installed at all keeps its old behavior. A test module checks
  the same signatures against the installed Hermes (skipped only where there is none; an installed Hermes that fails to import fails it), and a scan test keeps every other
  file off Hermes. `docs/CONTRACT.md` lists the code and the contract.
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
  nginx. Be brief.") is still a question, and a draft with a long run of spaces no longer freezes the Studio. "A plan
  to configure nginx" (or "a migration plan", "outline a plan") asks for the plan, "Do not access production. Can
  you build the app?" is a request, not a question, an indirect prohibition ("I do not want you to configure") is
  still one, "Can you tell me how to configure nginx?" asks for an explanation, and "Include a code example" after
  a question is not an order. A blank line ends a question ("How do I configure nginx\n\nBe brief."), "Write an API
  documentation generator script" is code, and "What I need: build a React dashboard" is the order it states. "The
  API is not ready, review the code" is a review, "Can you please tell me how to configure nginx?" is a question,
  and "Plan is ready. Build a React dashboard." is the build. "Can you help me fix the login bug?" is the fix,
  "help me understand" is a question, and a video or podcast script is writing, while a Python script for a video
  is code. "Do you configure nginx by default?" is a question, and "Do not build the app or configure nginx"
  forbids both. "Please carefully plan before you configure nginx" asks for the plan, "Can you tell me how to
  configure nginx" is a question even without its mark, and a school test is writing while a test for the API is code.
  "Tell me how to configure nginx" and "Me diga como instalar o Docker" are questions, and "Escreva uma revisão
  detalhada da API" is a review. "Do not write a review. Build a React app." is the build, and "Write a biology
  test with ten questions" is writing while a load test or a test suite is code. "Before we begin, can I configure
  nginx without downtime?" is a question, and "The configure script is broken. Review it." is a review. "Help me
  plan deployment before we configure nginx" asks for the plan, and "I need a script to write log files" is code,
  as is "I need a script to configure nginx". "Do not deploy, review the code instead" is the review, "Can you help me
  plan deployment before we configure nginx?" is the plan, and "Review failed deployments" is the review. "Can you walk
  through the repository and fix the login bug?" is the fix, and "What I need is for you to build a React dashboard, can
  you do that?" is the build, while "Can you tell me how to configure nginx and deploy the app?" stays a question. "I
  need a script that will configure nginx" is code. "Can you explain cron and the steps to configure nginx?" stays a
  question, and "Do not configure nginx, review the API and report findings." is the review. "Ajude-me a revisar código"
  is a review, "Crie uma planilha detalhada com as vendas" is data, and "Como especialista em segurança, você pode
  revisar esta API?" is the review it asks for, as are "The build is broken. Review the dashboard code." and "The goal
  is to write a Python script. Review the existing code."; "Do not install anything. How do I configure nginx?" and "Do I need to
  configure nginx" stay questions, "We have a plan to build the app. Review it." is the review, and "As a security
  expert, review API authentication before we configure nginx" is too, as are "Write a review highlighting security
  flaws in the API." and "Revisão e auditoria da API antes de configurar nginx". "Can you recommend a design and build
  a React dashboard?" is the build and "Can you explain cron and then review it?" is the review, while "Can you explain
  why we first configure nginx and then build the app?" stays a question. "I need a script. Write it in Python" and
  "Write a script for video processing in Python" are code, as is "I need a React app. Write it in TypeScript with
  documentation."; "Tell me how to configure nginx!" stays a question, "Have a look at the repository and fix the login
  bug." is the fix, and "Create a spreadsheet containing the sales data." is data. "Can you give me a plan to configure
  nginx?" is the plan, a requirement such as "Include documentation" no longer turns a requested script into text, and
  "I need a blog post explaining how to configure nginx." stays text. "I need instructions to configure nginx" is a
  question and "I need a script. Please write it in Python with documentation." is code, as is "Write a Python script
  without documentation"; "How do I build a React app? Add examples." stays a question and "Write a strategy memo about
  optimizing SQL queries" stays text. "How do I build a React app? Add examples; then fix the login bug." is the fix
  and "Write a review without modifying the API." is the review. "Write a Python script but not documentation." is
  code, "Please show me a script that extracts data." is code and "Can you show me a plan to configure nginx?" is a
  plan, and "Create a workflow using GitHub Actions." is a workflow. "Escreva uma revisão desta API" is the review, and a
  draft that repeats a stated goal thousands of times is analysed in milliseconds.
- Fix: *Gere um e-mail*, *Monte uma mensagem* and the like stay text, reports and summaries are text even when they
  mention tests ("Write a summary of the test results", "Escreva um relatório dos testes"), and a question such as
  "Como instalar o Docker?" or "Como resumir um livro?" stays an answer on Opus, Sonnet and Astra.
- Fix: the Sonnet 5.5 rule that asks for a real check before reporting code changes as done no longer contains the word "sudo" (it now says "never with elevated privileges or the system package manager"), so `hermes plugins validate` no longer shows a `sudo_usage` caution.
- Repository housekeeping: the CHANGELOG no longer carries internal audit codes, `.gitignore` covers only this project, generated files are marked `linguist-generated`, and the build script fails clearly on a missing output, checks name collisions across all UI files and has tests. Its syntax check runs in-process, writing nothing and starting no process (so `--check` also runs in a read-only sandbox), and text that only looks like an export inside a template literal, string or comment is left untouched, including after a regex literal that follows `return` (even with a comment between them) or an `if (…)` condition, a division after `count++`, or an emoji in a comment.
- New target: **Claude Sonnet 5.5** (Alt+T, or pick **Sonnet**), next to Opus and Astra. It has its own prompt engine,
  question help and AI writer rules from Anthropic's Sonnet 5.5 prompting guide, and is the default when the
  session's model is a Sonnet. Opus and Astra prompts do not change.
- Fix: "Não foi possível usar a IA agora" / "Could not use the AI this time" on every step when Hermes hosts more
  than one profile (the dashboard then refuses credential reads with no profile bound, `UnscopedSecretError` in
  `agent.log`). Each model call now keeps the profile of the request that asked for it.
- Fix: questions and suggestions stopped loading after picking, in Settings, a model whose route refuses JSON mode
  (for example the Claude subscription provider, `Only json_schema structured output is supported` in `agent.log`).
  The Studio now retries that call once without JSON mode and reads the JSON from the reply text.
- Internal: `bin/pr` and `bin/review` work outside the maintainer's machine: no personal name, the base branch comes
  from the repository (`BASE_BRANCH` overrides it), the local review verdict goes into the PR body, a hung Codex run
  stops after `CODEX_TIMEOUT_SECONDS` (default 900) and never approves, and the base is fetched once.
  An interrupted review (Ctrl+C, hangup) also stops the detached Codex process group and never approves, and the base
  branch is fetched into `origin/<base>` with an explicit refspec, so `BASE_BRANCH` works in a single-branch clone. The default branch is asked of origin, so a default changed
  on GitHub (main to trunk) is followed even when the clone's cached `origin/HEAD` is stale; when origin cannot be reached or does not answer in
  time, the cached `origin/HEAD` is used. Updating the review section of a PR description never deletes handwritten
  text, even after a stray review marker.

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
