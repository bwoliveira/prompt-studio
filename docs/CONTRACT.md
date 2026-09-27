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

Size limits on both routes: draft, answers and `baseline` up to 250 000 characters each, questions/hints/guidance
20 000, ids/kinds/target/mode/locale 200; `ladder`, `answers` and `options` at most 50 items. Over the limit: FastAPI
422 (the desktop treats it as "no AI"). The configured `auxiliary.prompt_studio.timeout` can lower the /suggest
provider timeout; /compose always gets its full 45 s.

Errors on every route: `ok: false` with `error`; nothing is ever replaced by a made-up answer.

Engine failures (`ok: false` from /suggest and /compose, HTTP 200) also carry a stable machine `code`; `error` is a short
English technical detail for logs and tests, never provider text (provider exceptions are logged server-side and only
their class name is returned). The desktop shows its own localized text for `code` (en/pt, `errors.<code>`) and falls
back to `error` when the code is unknown or absent.

| `code` | Route | When | `error` |
|---|---|---|---|
| `bad_request` | both | draft (or /suggest field question) missing | `intent and field.question are required` / `intent is required` |
| `nothing_to_improve` | /suggest | `improve` on a choice field or with no `answer` | fixed sentence |
| `invalid_suggestion` | /suggest | reply is not JSON with `value` | fixed sentence |
| `unknown_option` | /suggest | enum `value` is not one of `field.options` | fixed sentence |
| `invalid_prompt` | /compose | reply has no `prompt` of at least 20 characters | fixed sentence |
| `timeout` | both | no reply before the deadline | `no model reply within 20 s` / `no prompt from the model within 45 s` |
| `unavailable` | both | the provider call raised | `model unavailable: <ExceptionClassName>` |
| `empty_reply` | both | empty reply twice (also `empty: true`) | fixed sentence |

`timeout`, `unavailable` and `empty_reply` also carry `model`. The route-level errors (400 for a blank draft, 500
`{ "ok": false, "error": "suggest engine unavailable" }` / `"compose engine unavailable"` when the engine cannot load
or crashes, 422 over the size limits) have no `code`.

In /compose, any third-party framing the model writes itself (a `THIRD-PARTY MATERIAL` header line, `<pasted_content …>`
or `<document>` spans) is removed; the final prompt carries only the Studio's own restored block, if any. The v1 routes
`/interrogate` and `/brief` no longer exist.
