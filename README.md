# Prompt Studio

Prompt Studio is a Hermes Desktop plugin that turns a rough request into a well-built prompt for
**Claude Opus 5.5** or **GPT-6 Astra**. It asks the few questions that change the result, one step at a
time, with a recommended answer on each step. Then it writes the prompt and places it in the message
field for you to review. It never sends anything on its own.

Each step can get a suggestion from a fast auxiliary model, and at the end that model can polish the
prompt from your answers. When the AI is off, slow or unavailable, you still get a complete prompt,
built locally by the plugin's own engine for the chosen model.

The two prompt engines were written for this plugin from the official Anthropic and OpenAI documentation.

## Built for Claude Opus 5.5 and GPT-6 Astra

The two models need different prompts, and the engines follow each vendor's guidance:

- **Claude Opus 5.5** (Anthropic, *Prompting Claude Opus 5.5* and the prompting best practices):
  - Pasted material goes in `<pasted_content>` tags with the documented note; long material goes above the task.
  - Autonomy is stated plainly, and "explore first" is added when the request gives little context.
  - Scope stays to what was asked.
  - No "double-check your work" lines: Opus verifies on its own, so the prompt asks for evidence instead,
    such as the commands run and what they returned.
- **GPT-6 Astra** (OpenAI, *Using GPT-6* and *Rethinking skills and prompts for GPT-6 Astra*):
  - The request is stated to take precedence over skills and `AGENTS.md`.
  - An action request is framed as work to finish, not a plan to propose.
  - Only the official testing line is used, without extra verification lines.
  - The plain-writing lines apply to text answers.
  - Pasted material goes last, inside `<document>` tags.
- **Both models:**
  - An optional **subagents** step. "Team" splits the task into independent parts that run in parallel,
    and names one reviewer who did not write any of the work and starts from a fresh context.
  - Examples go in `<example>` tags.
  - Pasted text is escaped so it cannot close its tags, and it is marked as data, not instructions.

`docs/PROMPT-DOCS-REVIEW.md` lists every rule line with the quote it comes from.

## How it works

1. Write your request in the message field and press **F4**, or click **✨ Prompt Studio**, or run
   *Prompt Studio* from the command palette.
2. Pick the model (**Opus** or **Astra**). The first default follows the session's model.
3. Answer the steps. Depending on the request, they are:
   - what you want to receive
   - reference text to paste, and where it came from
   - context
   - rules that cannot be broken
   - how you will know it is done
   - interface patterns to avoid (Opus, code work)
   - autonomy
   - subagents
   - an example of the result
   - format
   - length

   Every step has a recommended choice. You can skip, go back, or edit any earlier answer.
4. Generate. The preview shows the prompt; switch between the AI version and the version built without AI,
   then **Use this prompt** to place it in the message field.

## Keyboard

Every control shows its key next to its label. Keys work with the cursor in the answer field.

| Key | Action |
|---|---|
| F4 | Open Prompt Studio (from the message field) |
| F1 | Show or hide the list of shortcuts |
| F3 | Settings: models, session context, language |
| F5 | Accept the recommended choice, or confirm what you typed |
| F6 | Skip / I don't have one |
| F7 | Use the AI suggestion (it goes into the field; F5 then confirms it) |
| F8 | Back / undo the edit / back to the steps |
| F9 | Generate the prompt, then use it |
| F10 | Close and return the draft |
| Alt+1 … Alt+9 | Pick an option |
| Alt+Shift+1 … Alt+Shift+9 | Edit an answered step |
| Alt+S | Ask the AI, or try again |
| Alt+N | Another suggestion |
| Alt+D | Discard the suggestion, or stop the AI |
| Alt+M | Improve my text |
| Alt+C | Paste text |
| Alt+O / Alt+A | Write for Opus / Astra |
| Alt+I | Next AI mode (Auto, On request, Off) |
| Alt+V | Other version in the preview |

Keys and scope:

- **Studio closed:** only F4 is used, and only from the message field.
- **Never captured:** the studio's key listener never takes Tab, Enter, Esc or chords with Ctrl or Super.
  Inside the studio's own answer field, keys stay in that field (Enter makes a new line), so typing an
  answer never triggers the app's composer.
- **Alt:** use the left Alt. Alt+digits follow the physical number row, whatever the keyboard layout.
- **Conflicts checked:** these keys were checked against Hermes Desktop's own bindings and the Linux Mint
  (Cinnamon) desktop, which uses only Alt with the F-keys.

## Install

Prompt Studio is installed from a checkout of this repository with `install.sh`, which needs the `hermes`
CLI (on `PATH`, or set `HERMES_BIN`):

```bash
cd prompt-studio        # your checkout of this repository
./install.sh            # default Hermes home (~/.hermes)
./install.sh --profile <name>   # or a named profile
./install.sh --home <path>      # or a custom Hermes home
```

It checks the manifest and the Hermes version, copies the package (with its desktop half) into
`plugins/prompt-studio/`, and changes configuration only through the `hermes` CLI (`hermes plugins enable`,
`hermes config set`). It is safe to re-run; run it again after `git pull` to update.

Then close and reopen Hermes Desktop so the backend mounts the plugin's routes and copies the desktop half
out. **Capabilities → Plugins** should show *Prompt Studio* enabled. Requires Hermes 0.20.0 or later.

**Remote backend** (Desktop connected over SSH or a URL): run `install.sh` on the backend host, then copy
`desktop/plugin.js` to `~/.hermes/desktop-plugins/prompt-studio/plugin.js` on the machine that runs
the app.

> This repository is not published yet. Once it is on GitHub, `hermes plugins install
> <owner>/prompt-studio --enable` will install it directly; until then, use `install.sh` as above.

## Choose the model

The suggestions and the final polish use the auxiliary task `prompt_studio`. Pick its model like any
other side model:

- **CLI:** `hermes model` → *Configure auxiliary models* → **Prompt Studio**
- **config.yaml:**

  ```yaml
  auxiliary:
    prompt_studio:
      provider: anthropic
      model: claude-opus-5-5
      reasoning_effort: low
      timeout: 20
  ```

`timeout` applies to each step's suggestion (it can lower the 20 s step limit); the final polish always gets its own 45 s budget. A fast model keeps each step at a few seconds. If `prompt_studio` pins no provider or model, the task
follows the main model.

## Language

The interface is in English and uses the Hermes Desktop plugin translation API (`ctx.i18n`). A
Brazilian Portuguese bundle ships with the plugin and is used once Hermes Desktop offers that language.
The prompt itself follows the language of your request.

## How it follows the Hermes plugin guidelines

- **One package with three parts:** `plugin.yaml` + `__init__.py` (the agent half registers the
  `prompt_studio` auxiliary task), `dashboard/` (REST routes at `/api/plugins/prompt-studio/`) and
  `desktop/plugin.js` (the Desktop half).
- **SDK only:** the Desktop half imports only `@hermes/plugin-sdk` and `react`.
- **Host-tracked resources:** the key listener goes through `ctx.addEventListener`, preferences through
  `ctx.storage`, text through `ctx.i18n`, and colours through theme variables.
- **Declared capabilities match reality:** no tools, hooks, middleware or environment variables.
- **No self-updating code:** updates come only from a new catalog pin.
- **Validation:** `hermes plugins validate .` passes.

## Develop

```bash
node scripts/build.mjs            # inline desktop/src/* into desktop/plugin.js
node scripts/build.mjs --check    # fails if plugin.js is out of date
node --test tests/desktop/*.test.mjs
uvx --with fastapi --with httpx --with pyyaml pytest -q tests
hermes plugins validate .
```

The source is in `desktop/src/` (engines, studio core, translations). `desktop/plugin.js` is the single
file Hermes Desktop loads, so the build inlines the sources into it. Developer notes are in
`docs/DESKTOP-DEV.md`, the REST contract is in `docs/CONTRACT.md`, and the reason for each step is in
`docs/STEPS-REVIEW.md`.

## Credits

The idea for Prompt Studio came from:

- the [grill-tab](https://github.com/thanhan-a17/grill-tab) repository by thanhan-a17, which asks one
  decision at a time and turns the answers into a brief;
- two prompt-builder sites for specific models: a Claude Opus 5.5 prompt builder
  (<https://dreamy-mudra-cj75.here.now/>) and a GPT-6 Astra prompt builder
  (<https://sable-valley-eyrb.here.now/>, MIT source at <https://github.com/Eddienews/astra-prompt-builder>).

Prompt Studio's prompt engines were written from scratch from the official Anthropic and OpenAI
documentation and contain no code from those sites. Parts of the packaging and backend scaffolding are
derived from grill-tab, so `LICENSE` keeps its MIT copyright notice.

## License

MIT. See `LICENSE`.
