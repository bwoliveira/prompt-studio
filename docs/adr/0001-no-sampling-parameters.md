# 0001. The plugin sends no sampling parameters

Status: Accepted (2026-10-02)

## Context

Prompt Studio calls a model for step suggestions, for the session summary and for the final polish. Models differ in
which sampling parameters they accept and in what a good value is, and Hermes already knows that for each model it
routes to. A temperature or top_p fixed by the plugin would be right for one model and wrong or rejected for another,
and it would silently override what the user configured in Hermes.

## Decision

The plugin sends no sampling parameters (`temperature`, `top_p`) to the model. The backend passes only the messages,
`max_tokens`, the timeout, the JSON mode and, when the user picked them, a model and a reasoning effort. Hermes decides the sampling for each model.

## Consequences

- One behaviour for every provider and model, including ones added to Hermes later; nothing to retune per model.
- Output varies from run to run as far as the model's own defaults allow; the local engines stay deterministic, so the
  prompt built without AI is reproducible.
- The plugin cannot offer a "more creative" or "more exact" setting.
- A rule for contributors and agents (`AGENTS.md`): no change adds a sampling parameter to a model call.

Revisit when Hermes offers a per-call sampling option that it validates for the chosen model.
