# Prompt Studio REST contract

Base: `/api/plugins/prompt-studio` (the desktop half calls it via `ctx.rest('/…')`). The steps and the baseline
prompt are built in the desktop half by the Studio's own prompt engines; the backend serves the AI help. Model:
auxiliary task `prompt_studio` (config block `auxiliary.prompt_studio`; with no provider or model pinned it follows
the main model). Request models declare every field
below: undeclared fields are dropped.

`locale` (both POST routes, optional): `"en"` (default) or `"pt"`. It sets the language of the human-facing text the
model returns (`reason` for /suggest, `notes` for /compose): English for `en`, Brazilian Portuguese for `pt`; any other
value is treated as `en`. It never changes the prompt itself, which follows the language of the user's draft.

## POST /suggest
```json
{
  "target": "opus|astra",
  "intent": "the user's draft (required)",
  "ladder": [ { "question": "string", "answer": "string", "category": "field id|null" } ],
  "mode": "suggest|improve (default suggest)",
  "answer": "user's own text, required for improve",
  "locale": "en|pt (default en)",
  "field": {
    "id": "autonomy",
    "kind": "enum|text|design|example",
    "question": "string (required)",
    "options": ["exact option labels, enum only"],
    "recommended": "default option label|null",
    "hint": "current default text|null",
    "guide": "extra instruction for this field|null"
  }
}
```
Response: `{ "ok": true, "value": "…", "reason": "one sentence in the locale language", "agrees": true, "mode": "suggest",
"model": "provider/model", "latency_ms": 2500, "source": "model" }`.

For `enum`, `value` is always one of `field.options`. For text fields `value` may be empty (nothing to add; with a
default, the desktop offers "use the default"). `improve` rewrites `answer` without adding facts. Hard 20 s
deadline. Pasted third-party text in the ladder is marked as untrusted data.

## POST /compose
```json
{
  "target": "opus|astra",
  "intent": "the user's draft (required)",
  "answers": [ { "id": "field id", "kind": "enum|text|design|example", "question": "…", "answer": "…", "isDefault": true } ],
  "baseline": "the engine's prompt for the same answers",
  "locale": "en|pt (default en)"
}
```
Response: `{ "ok": true, "prompt": "…", "notes": "one sentence in the locale language", "model": "…", "latency_ms": 5000, "source": "model" }`.
The pasted block in `baseline` (`THIRD-PARTY MATERIAL` + `<document>`, or the older `<pasted_content id>` shape) is
replaced by a marker before the model sees it and restored byte for byte afterwards. Hard 45 s deadline; the desktop
waits 50 s and then uses `baseline`.

## GET /health
`{ "ok": true, "model": "provider/model resolved for task prompt_studio" }`; if the model adapter cannot load:
`{ "ok": false, "error": "llm adapter unavailable" }` (logged server-side).

Errors on every route: `ok: false` with `error`; nothing is ever replaced by a made-up answer. The v1 routes
`/interrogate` and `/brief` no longer exist.
