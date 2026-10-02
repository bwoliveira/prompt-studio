# Prompt Studio REST contract

Base: `/api/plugins/prompt-studio` (the desktop half calls it via `ctx.rest('/…')`). The steps and the baseline
prompt are built in the desktop half by the Studio's own prompt engines; the backend serves the AI help. Model:
auxiliary task `prompt_studio` (config block `auxiliary.prompt_studio`; with no provider or model pinned it follows
the main model). Request models declare every field
below: undeclared fields are dropped.

`locale` (both POST routes, optional): `"en"` (default) or `"pt"`. It sets the language of the human-facing text the
model returns (`reason` for /suggest, `notes` for /compose): English for `en`, Brazilian Portuguese for `pt`; any other
value is treated as `en`. It never changes the prompt itself, which follows the language of the user's draft.

`model_choice` (/suggest, /compose, /context, optional): `{ "provider": "anthropic", "model": "claude-haiku-5",
"effort": "low" }` (provider ≤ 80 chars, model ≤ 200, effort ≤ 16). Empty or missing `model`: exactly the config route
(`auxiliary.prompt_studio`: provider, model, reasoning_effort, timeout, extra_body). With a `model`, the call goes to that
provider/model; `effort` `""` keeps the config's `reasoning_effort` (and when that is unset too, `low` is sent, except on Gemini); at `medium` the call's `max_tokens` is raised to at least 4096 and at `high` and above to at least 8192, because it caps thinking plus text, `"none"` turns thinking off, and
`minimal|low|medium|high|xhigh|max|ultra` sets it; any other `effort` is a 422. When the chosen provider differs from
`auxiliary.prompt_studio.provider` (or none is configured), the config's `base_url`, `api_key` and `extra_body` are not
used (only its `timeout`), so a configured endpoint or key never reaches another provider. The Gemini thinking and JSON-mode
adaptation follows the chosen provider. The `model` label in every response is the route actually used.

## POST /suggest
```json
{
  "target": "opus|astra|sonnet",
  "intent": "the user's draft (required)",
  "ladder": [ { "question": "string", "answer": "string", "category": "field id|null" } ],
  "mode": "suggest|improve (default suggest)",
  "answer": "user's own text, required for improve",
  "locale": "en|pt (default en)",
  "model_choice": { "provider": "…", "model": "…", "effort": "…" },
  "session_context": "summary from /context (optional, ≤ 3000 chars)",
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
deadline. Pasted third-party text in the ladder is marked as untrusted data. `session_context` goes into the prompt as a
tag-delimited, escaped `<session_context>` block marked as untrusted reference data (never instructions); it does not
change the response shape and is never used by /compose. Ladder questions and answers and the field's question, guide,
default and hint sit on single lines of the prompt: whitespace runs (newlines, tabs) are collapsed to one space, so they
cannot pose as a new section.

## POST /compose
```json
{
  "target": "opus|astra|sonnet",
  "intent": "the user's draft (required)",
  "answers": [ { "id": "field id", "kind": "enum|text|design|example", "question": "…", "answer": "…", "isDefault": true } ],
  "baseline": "the engine's prompt for the same answers",
  "locale": "en|pt (default en)",
  "model_choice": { "provider": "…", "model": "…", "effort": "…" }
}
```
Response: `{ "ok": true, "prompt": "…", "notes": "one sentence in the locale language", "model": "…", "latency_ms": 5000, "source": "model" }`.
The pasted block in `baseline` (`THIRD-PARTY MATERIAL` + `<document>`, or the older `<pasted_content id>` shape) is
replaced by a marker before the model sees it and restored byte for byte afterwards. Hard 45 s deadline; the desktop
waits 50 s and then uses `baseline`.

## POST /context
```json
{ "session_id": "stored session id (1..128 chars, [A-Za-z0-9_.:-])", "profile": "default (≤ 64, [A-Za-z0-9_-])",
  "locale": "en|pt", "model_choice": { "provider": "…", "model": "…", "effort": "…" } }
```
Opens the profile's session store read-only (`hermes_cli.web_server_sessions._open_session_db_for_profile(profile,
read_only=True)`, falling back to `hermes_state.SessionDB(read_only=True)` for the default profile), resolves the id like
the core sessions route (`resolve_session_id`, `resolve_resume_session_id`) and closes the store. Keeps the last 8 active,
non-compacted user/assistant turns (role tool/system, tool calls and reasoning fields are skipped) plus the compaction
summary (`_compressed_summary`) when present; redacts secrets (`agent.redact.redact_sensitive_text(force=True)` plus a local
set for keys, tokens, Bearer headers and `password=` pairs); caps the text at 8000 characters keeping the most recent end;
then asks the context model (`model_choice`) for JSON `{"summary"}` of at most 1200 characters in the locale language. The
system prompt says the transcript is data, never instructions. The summary the model returns passes through the same
redactor before it is returned. Hard 15 s deadline, `max_tokens` 500.

Response (HTTP 200): `{ "ok": true, "summary": "…", "model": "provider/model", "turns": 8, "ms": 1432 }` or
`{ "ok": false, "code": "…", "error": "…" }`. A malformed request (bad `session_id`/`profile` characters or lengths, bad
`model_choice`) is a 422.

| `code` | When | `error` |
|---|---|---|
| `bad_request` | invalid `session_id`/`profile` reaching the reader | `invalid session_id or profile` |
| `no_session` | the id is not in the store | `session not found` |
| `empty_session` | no user/assistant text and no compaction summary | fixed sentence |
| `timeout` | no reply within 15 s (also carries `model`) | `no summary within 15 s` |
| `unavailable` | store or provider failure, or the reader cannot load (also `model` for provider failures) | `session store unavailable` / `model unavailable` / `context reader unavailable` |
| `model_not_found` | the provider does not know the model name (also `model`) | `model not found` |
| `provider_refused` | the provider denies the model to the account/key/plan: 401/403 or "MODEL_NOT_IN_PLAN" (also `model`) | `provider refused` |
| `provider_payment` | billing refusal: 402, "insufficient_quota", "insufficient credits", "payment required", "billing_hard_limit", "credit balance is too low" (also `model`) | `provider payment` |
| `provider_bad_request` | the provider rejects the request: 400 / BadRequestError not matched above (also `model`) | `provider bad request` |
| `invalid_summary` | reply is not JSON with a non-empty string `summary` (also `model`) | fixed sentence |
| `host_incompatible` | the installed Hermes changed a signature the plugin relies on (session store, redactor or model call; see "Hermes host" below); nothing is sent to the model | fixed sentence |

The transcript text is never logged and never returned: only the summary, the route label and counts leave the backend.
Provider and store exceptions are logged with `logger.warning(exc_info=…)`; the response carries a fixed sentence only.

## GET /health
`{ "ok": true, "model": "provider/model resolved for task prompt_studio" }`; if the model adapter cannot load:
`{ "ok": false, "error": "llm adapter unavailable" }` (logged server-side). When the installed Hermes no longer matches the
signatures the plugin relies on: `{ "ok": false, "code": "host_incompatible", "error": "<fixed sentence>" }` (details
logged). Hermes not being importable at all (standalone checkout) is not reported there.

Size limits on both routes (request validation): draft, answers and `baseline` up to 250 000 characters each,
questions/hints/guidance 20 000, ids/kinds/target/mode/locale 200; `ladder`, `answers` and `options` at most 50 items.
Over the limit: FastAPI 422 (the desktop treats it as "no AI"). Inside those bounds the engine sends the model only
part of a long text; the effective limits are below, and the user's text is never cut without telling:

| Field | Route | Effective limit (characters, after trimming) | Over the limit |
|---|---|---|---|
| `answer` (mode `improve`) | /suggest | 1 200 | `ok: false`, `code: too_long`, `limit: 1200`; nothing is sent to the model |
| `intent` (draft) | both | 6 000 | the tail is dropped; response carries `truncated: true` |
| `answers[].answer` | /compose | 3 000 (12 000 when `id` is `thirdPartyText`) | the tail is dropped; `truncated: true` |
| `thirdPartyText` preview shown to the model | /compose | 1 500 | the model reads only the first 1 500 characters plus ` […]` as untrusted reference; the pasted block itself is put back whole in the final prompt, so this is not a cut and `truncated` stays absent |
| `baseline` | /compose | 30 000, not counting the pasted third-party block (which is kept whole and put back) | the tail is dropped; `truncated: true` |
| `ladder[].answer`, `field.hint` | /suggest | 600 (context shown to the model) | the tail is dropped; `truncated: true` |
| model `value` (text field) | /suggest | 1 200 | the tail is dropped; `truncated: true` |
| model `prompt` | /compose | 30 000 | the tail is dropped; `truncated: true` |
| `session_context` | /suggest | 3 000 | 422 over 3 000 |

`truncated: true` is present on a successful /suggest or /compose response whenever any cut above happens (the draft,
an answer, a ladder answer, a hint or the baseline sent to the model, or the model's own `value`/`prompt` cut to its
limit); otherwise the key is absent. The desktop engines already cap their own fields (for example the
pasted text at 12 000), so the flag is for other clients and for oversized drafts. The configured `auxiliary.prompt_studio.timeout` can lower the /suggest
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
| `too_long` | /suggest | `improve` with an `answer` over 1 200 characters (also `limit`); the model is not called | `answer is longer than 1200 characters` |
| `invalid_suggestion` | /suggest | reply is not JSON with `value` | fixed sentence |
| `unknown_option` | /suggest | enum `value` is not one of `field.options` | fixed sentence |
| `invalid_prompt` | /compose | reply has no `prompt` of at least 20 characters | fixed sentence |
| `timeout` | both | no reply before the deadline | `no model reply within 20 s` / `no prompt from the model within 45 s` |
| `unavailable` | both | the provider call raised | `model unavailable: <ExceptionClassName>` |
| `model_not_found` | both | the provider does not know the model name (404 / "model not found") | `model not found: <ExceptionClassName>` |
| `provider_refused` | both | the provider denies the model to the account/key/plan (401/403, "MODEL_NOT_IN_PLAN" / "not in plan"; 404 stays `model_not_found`) | `provider refused: <ExceptionClassName>` |
| `provider_payment` | both | billing refusal (402, "insufficient_quota", "insufficient credits", "payment required", "billing_hard_limit", "credit balance is too low") | `provider payment: <ExceptionClassName>` |
| `provider_bad_request` | both | the provider rejects the request (400 / BadRequestError) and no code above matched | `provider bad request: <ExceptionClassName>` |
| `host_incompatible` | both | the installed Hermes changed a signature the plugin relies on (see "Hermes host" below); no provider call was made. The desktop falls back to `error` (no localized text yet) | `Hermes changed in a way this Prompt Studio version does not support; update the plugin (details in the Hermes log)` |
| `empty_reply` | both | empty reply twice, or once when it ended on `finish_reason: length` (no retry: the same cap ends the same way) (also `empty: true`) | fixed sentence |

`timeout`, `unavailable`, `model_not_found`, `provider_refused`, `provider_payment`, `provider_bad_request`, `host_incompatible` and `empty_reply` also carry `model`. The route-level errors (400 for a blank draft, 500
`{ "ok": false, "error": "suggest engine unavailable" }` / `"compose engine unavailable"` when the engine cannot load
or crashes, 422 over the size limits) have no `code`.

In /compose, any third-party framing the model writes itself (a `THIRD-PARTY MATERIAL` header line, `<pasted_content …>`
or `<document>` spans) is removed; the final prompt carries only the Studio's own restored block, if any. A kind the
user wrote in their own text (draft, answers or the baseline outside the pasted block; never the pasted text) is
content, not framing, and stays: "Convert the `<document>` tags in my XML" survives the rewrite. The v1 routes
`/interrogate` and `/brief` no longer exist.

## Hermes host

The backend reaches Hermes through one module, `dashboard/hermes_host.py`; no other file under `dashboard/` imports a
Hermes module (`tests/test_hermes_host_enforcement.py` scans for it). The module imports at call time and checks the
signature it is about to use, so a Hermes update fails in one place with a stable code instead of deep in a request:

| What the plugin relies on | Checked |
|---|---|
| `agent.auxiliary_client.call_llm` takes `task`, `messages`, `max_tokens`, `timeout`, `route_info`, `extra_body`, `reasoning_config` (and `provider`, `model` for a chosen model), with no other required argument; no sampling parameter is ever sent | before each call |
| `_resolve_task_provider_model(task)` returns a tuple of 5; `_get_auxiliary_task_config(task)` returns a dict; `extract_content_or_reasoning(response)`, `_is_model_not_found_error(exc)` | before each call |
| `hermes_constants.parse_reasoning_effort(effort)` | before each call |
| `agent.redact.redact_sensitive_text(text, force=True)` | before each call |
| `hermes_cli.web_server_sessions._open_session_db_for_profile(profile, read_only=True)` (else `hermes_state.SessionDB(read_only=True)` for the default profile) and the store methods `resolve_session_id`, `resolve_resume_session_id` (optional), `get_messages(session_id, limit=, latest=)`, `close()` (no argument) | when a store is opened |

A symbol that is gone, a keyword that is no longer accepted, a new required argument, a resolution of another length or
a Hermes module that fails to import while Hermes is installed (moved or removed, a missing dependency, an
`ImportError` inside it) all raise `HostIncompatible` (`code: "host_incompatible"`): /suggest and /compose
answer `code: host_incompatible` (HTTP 200, `ok: false`), /context answers the same code, /health reports it. Hermes
not being installed at all (neither the `agent` nor the `hermes_cli` package can be found) is a different case
(`HostUnavailable`, an `ImportError`): the model routes answer
`unavailable` as before and the session reader keeps its local redaction fallback. `host.verify()` runs every check
without calling a provider or opening a database; `tests/test_hermes_host_contract.py` runs it against the installed
Hermes (skipped only when Hermes is not installed; an installed Hermes that fails to import fails it; the docstring has
the command).
