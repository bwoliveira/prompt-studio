# Configuration details

Moved from the README, which keeps the Settings (F3) summary and the minimal `auxiliary.prompt_studio` block.

## Auxiliary task `auxiliary.prompt_studio`

Without a pick, the suggestions and the final polish use the auxiliary task `prompt_studio`. Pick its model
like any other side model:

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

- `timeout` applies to each step's suggestion (it can lower the 20 s step limit); the final polish always
  gets its own 45 s budget. A fast model keeps each step at a few seconds.
- If `prompt_studio` pins no provider or model, the task follows the main model.
- If suggestions fail with "API key not accepted" (401), "provider refused" (403: model not in your plan), a billing
  note (402: no credits or quota), "rejected the request" (400), "limiting requests" (429) or "did not answer in
  time" (the provider call timed out), the provider, key, plan or route is the cause, not the Studio. The prompt can
  still be built without AI (Off mode).
- **Command Code:**
  - For Claude models use the provider `commandcode-anthropic` (alias `commandcode-claude`), not `commandcode`.
    Hermes sends `commandcode` through chat completions, and a tester saw Command Code answer 400 for Claude
    models there, asking for the `/provider/v1/messages` endpoint.
  - Pick the model explicitly: in Settings (F3), e.g. `claude-opus-5-5` on `commandcode-anthropic`, or with
    `auxiliary.prompt_studio.provider` and `model` in `config.yaml`. The Studio then passes that provider and model
    to Hermes as given.
  - Likely cause of 403 `MODEL_NOT_IN_PLAN` while the main chat works (not yet confirmed on a real account): with
    no model set, Hermes's auxiliary client uses the provider's default auxiliary model
    (`claude-haiku-4-5-20251001` on `commandcode-anthropic`, `deepseek/deepseek-v4-flash` on `commandcode`), and
    a plan without that model refuses it.
- **Default effort:** with no `reasoning_effort` and no level in Settings, the plugin asks for `low`
  (except on Gemini, where thinking stays off).
- **Effort-aware `max_tokens`:** `max_tokens` covers thinking plus text, so at medium effort a smaller cap is
  raised to 4096, and at high effort and above to 8192. A larger cap is kept.

- `hermes config set auxiliary.prompt_studio.<field> …` prints *"not a recognized config key — it was saved
  anyway"*. The warning is harmless: the CLI checks keys against Hermes's built-in list only, which does not
  include auxiliary tasks registered by plugins. The value is saved and the plugin reads it. Add `--force` to skip
  the warning, or edit `config.yaml` directly.

The REST routes and their request and response shapes are in `CONTRACT.md`.
