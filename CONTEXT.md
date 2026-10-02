# Context

The vocabulary of Prompt Studio. Definitions only: how things are built is in `CONTRIBUTING.md`, `docs/DESKTOP-DEV.md` and
the decisions in `docs/adr/`.

**Prompt Studio**: the Hermes Desktop plugin as a whole, and its guided prompt builder, the **Studio**, opened over the
message field.

**Draft**: the rough request the user wrote in the message field. The Studio takes it as the starting point and returns it
untouched when the user closes without generating.

**Composer**: Hermes Desktop's message field. The Studio reads the draft from it and places the finished prompt in it; it
never sends on its own, except when the user picks "Send now".

**Target**: the model a prompt is written for: Claude Opus 5.5, Claude Sonnet 5.5 or GPT-6 Astra. The first default follows
the session's model.

**Engine**: the deterministic prompt writer of one target. It turns a brief into the prompt using only rule lines taken from
the vendor's documentation, with no AI call.

**Step**: one question the Studio asks, with a recommended answer. Which steps are asked depends on the draft and the target.

**Ladder**: the questions asked so far with their answers, in order. The user can skip, go back or edit any rung.

**Brief**: the answers of the ladder, together with the draft's goal, in the form an engine reads.

**Baseline**: the prompt the engine builds from the brief, without any AI. It is what the user gets when the AI is off, slow
or unavailable, and the starting point the AI polishes.

**Suggestion**: the answer the AI proposes for a step, with its reason. The user accepts it, asks for another or discards it.

**Polish**: the final AI pass that rewrites the baseline from the user's answers. The preview offers the polished version and
the baseline.

**AI mode**: when suggestions are requested: Auto, On request or Off.

**Helper model**: the model the user picks in Settings for the questions and the polish. With no pick, the auxiliary task
decides.

**Context model**: the model the user picks in Settings for reading the session's recent conversation into a short summary,
used only to improve suggestions.

**Auxiliary task**: Hermes's name for a side model with its own configuration. Prompt Studio registers the task
`prompt_studio` (`auxiliary.prompt_studio`); with no provider or model pinned it follows the main model.

**Studio core**: the part of the Desktop half that holds the step flow: the target registry, the steps and their order, and the
conversion of a ladder into a brief and a prompt. It has no user interface and no network.

**Pasted block**: reference text the user pastes into a step. It is escaped, marked as data and kept apart from instructions
in the prompt.

**Halves**: the plugin's three parts. The **agent half** (manifest and `__init__.py`) registers the auxiliary task. The
**backend half** (the dashboard routes) serves the AI help: suggestions, the polish and the session summary. The **desktop half**
(`desktop/plugin.js`) is the Studio itself, running inside Hermes Desktop.

**Shortcut map**: the single list of the Studio's keys, from which every printed key, the F1 help and the README keyboard table
are derived.
