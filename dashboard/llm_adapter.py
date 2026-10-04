"""Model adapter for the Prompt Studio routes.

Routes every call through Hermes' auxiliary client under the plugin's ``auxiliary.prompt_studio`` task,
with per-provider reasoning/JSON adaptation and a hard timeout the Studio deadlines rely on.
Pure helpers (JSON extraction, task-key resolution) are importable without Hermes for tests.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable, Mapping

try:  # package import inside `hermes serve`
    from . import hermes_host as host
except ImportError:  # loaded by path (tests / plugin_api fallback)
    import importlib.util
    from pathlib import Path

    _spec = importlib.util.spec_from_file_location("prompt_studio_hermes_host", Path(__file__).with_name("hermes_host.py"))
    if _spec is None or _spec.loader is None:
        raise ImportError("hermes_host.py not found beside llm_adapter.py") from None
    host = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(host)

logger = logging.getLogger(__name__)

# Auxiliary task registered by __init__.register(); its block is ``auxiliary.prompt_studio``.
_AUX_TASK = "prompt_studio"


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _strip_thinking(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return _without_thinking_blocks(text).strip()


# A JSON-mode retry needs at least this much of the budget left; less would only time out.
RETRY_MIN_SECONDS = 1.0

DEFAULT_EFFORT = "low"  # used when neither auxiliary.prompt_studio nor the Settings pick sets an effort

# Smallest max_tokens per effort. Opus 5.5 migration docs: "max_tokens remains a hard limit on total output,
# thinking plus response text"; what's new: "leave room in max_tokens for the thinking". A larger cap is kept.
EFFORT_MIN_TOKENS = {"medium": 4096, "high": 8192, "xhigh": 8192, "max": 8192, "ultra": 8192}


class Reply(tuple):
    """``(text, model)`` from one model call, plus the provider's ``finish_reason`` ("" when unknown).

    Still a 2-tuple, so every caller keeps unpacking ``text, model = reply``.
    """

    finish_reason: str

    def __new__(cls, text: str, model: str, finish_reason: str = "") -> "Reply":
        reply = super().__new__(cls, (text, model))
        reply.finish_reason = finish_reason
        return reply


def _finish_reason(response: Any) -> str:
    choices = response.get("choices") if isinstance(response, Mapping) else getattr(response, "choices", None)
    if not choices:
        return ""
    first = choices[0]
    value = first.get("finish_reason") if isinstance(first, Mapping) else getattr(first, "finish_reason", None)
    return value if isinstance(value, str) else ""


def _answer_content(response: Any) -> Any:
    """``message.content`` of the first choice: the answer, never the thinking.

    Read only content, never the host's reasoning fallback, and sanitize it here with JSON awareness.
    Text already cleaned here must not pass through the host's regex-based think-block stripping again.
    """
    choices = response.get("choices") if isinstance(response, Mapping) else getattr(response, "choices", None)
    first = choices[0] if choices else response
    message = first.get("message") if isinstance(first, Mapping) else getattr(first, "message", first)
    content = message.get("content") if isinstance(message, Mapping) else getattr(message, "content", None)
    return _answer_text(content)


# A closed thinking block outside a valid JSON value.
# Include the host's reasoning markers, including CJK, while preserving literal occurrences in JSON.
_THINKING_TAGS = r"think|thinking|reasoning|thought|reasoning_scratchpad|思考|反思|推理|推敲"
_CLOSED_THINKING = re.compile(r"<(" + _THINKING_TAGS + r")>.*?</\1>", re.DOTALL | re.IGNORECASE)
_THINKING_OR_JSON = re.compile(r"[\[{]|<(" + _THINKING_TAGS + r")>", re.IGNORECASE)


def _without_thinking_blocks(text: str) -> str:
    """Scan left to right: skip valid JSON intact, remove external reasoning before reading any JSON in it."""
    decoder = json.JSONDecoder()
    parts = []
    start = cursor = 0
    while match := _THINKING_OR_JSON.search(text, cursor):
        cursor = match.end()
        if match.group(1) is None:
            try:
                _, cursor = decoder.raw_decode(text, match.start())
            except json.JSONDecodeError:
                pass
            continue
        closed = _CLOSED_THINKING.match(text, match.start())
        if not closed:
            # A token-limit cutoff counts as a block only at the start of a line.
            line_prefix = text[text.rfind("\n", 0, match.start()) + 1:match.start()]
            if line_prefix.strip(" \t"):
                continue
        parts.append(text[start:match.start()])
        start = cursor = closed.end() if closed else len(text)
    parts.append(text[start:])
    return "".join(parts)


def _answer_text(content: Any) -> Any:
    """The answer text of ``content``: text parts of a list only, no thinking block, closed or unclosed."""
    if isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, str):
                texts.append(part)
                continue
            kind = part.get("type") if isinstance(part, Mapping) else getattr(part, "type", None)
            text = part.get("text") if isinstance(part, Mapping) else getattr(part, "text", None)
            if kind == "text" and isinstance(text, str):
                texts.append(text)
        content = "".join(texts)
    return _without_thinking_blocks(content) if isinstance(content, str) else content


def _loads_dict(text: str) -> dict[str, Any] | None:
    """json.loads ``text``; the value only when it is a dict, else None."""
    try:
        val = json.loads(text)
    except json.JSONDecodeError:
        return None
    return val if isinstance(val, dict) else None


def _fenced_json(cleaned: str) -> dict[str, Any] | None:
    """The dict inside the first markdown fence ```json ... ```, if valid."""
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    return _loads_dict(fence_match.group(1)) if fence_match else None


def _scan_json_objects(cleaned: str) -> list[dict[str, Any]]:
    """Every dict raw-decodable from a '{' occurrence, in order."""
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for match in re.finditer(r"\{", cleaned):
        try:
            value, _ = decoder.raw_decode(cleaned[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            candidates.append(value)
    return candidates


def _pick_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Prefer a candidate with the keys the Studio routes expect, else the first."""
    for cand in candidates:
        if "value" in cand or "prompt" in cand:
            return cand
    return candidates[0] if candidates else None


def _json_object(text: str) -> dict[str, Any] | None:
    """Find the best valid JSON object in prose or fences, never in external reasoning."""
    if not isinstance(text, str):
        return None
    cleaned = _strip_thinking(text)
    # 1. Direct JSON parse; 2. markdown fence; 3. scan across '{' occurrences.
    direct = _loads_dict(cleaned)
    if direct is not None:
        return direct
    fenced = _fenced_json(cleaned)
    if fenced is not None:
        return fenced
    return _pick_candidate(_scan_json_objects(cleaned))


def _choice(model_choice: Mapping[str, Any] | None) -> tuple[str, str, str] | None:
    """(provider, model, effort) of a per-task model choice, or None when no model is chosen
    (empty model = use the ``auxiliary.prompt_studio`` config, exactly as before)."""
    if not isinstance(model_choice, Mapping):
        return None
    model = _clean_text(model_choice.get("model"))
    if not model:
        return None
    return _clean_text(model_choice.get("provider")), model, _clean_text(model_choice.get("effort")).lower()


def _effort_and_cap(effort: Any, provider_norm: str, max_tokens: int) -> tuple[Any, int]:
    """Effort to send and the max_tokens to use with it.

    No effort in the config or the Settings pick: ask for "low" instead of the provider default (medium on
    Opus 5.5; docs: "Start at low effort and measure."). Gemini keeps its own branch, which turns thinking
    off when no effort is set. max_tokens caps thinking plus text, so a small cap is raised at higher effort
    (measured: effort max, cap 1024 -> 1023 reasoning tokens, finish_reason "length").
    """
    if not effort and provider_norm != "gemini":
        effort = DEFAULT_EFFORT
    return effort, max(max_tokens, EFFORT_MIN_TOKENS.get(str(effort or "").strip().lower(), 0))


def _apply_choice(task_config: dict[str, Any], provider: str, model: str, effort: Any,
                  model_choice: Mapping[str, Any] | None) -> tuple[str | None, dict[str, Any], str, str, Any, dict[str, Any]]:
    """The user's explicit provider/model/effort over the task's: (task, task_config, provider, model, effort, explicit)."""
    task: str | None = _AUX_TASK
    chosen = _choice(model_choice)
    if not chosen:
        return task, task_config, provider, model, effort, {}
    provider, model, chosen_effort = chosen
    explicit = {"provider": provider or None, "model": model}
    if chosen_effort:
        effort = chosen_effort
    cfg_provider = _clean_text(task_config.get("provider")).lower()
    if not provider or cfg_provider != provider.lower():
        # call_llm lends auxiliary.<task>.base_url/api_key to an explicit provider when the task
        # has no provider or the same one; another provider must never receive them.
        task = None
        task_config = {k: v for k, v in task_config.items() if k == "timeout"}
    return task, task_config, provider, model, effort, explicit


def _provider_body(task_config: Mapping[str, Any], provider_norm: str, effort: Any, reasoning_config: Any, is_json: bool) -> dict[str, Any]:
    """The extra_body for the provider: the task's own, then thinking for Gemini and JSON mode where it will not 400."""
    extra_body: dict[str, Any] = {}
    configured_extra = task_config.get("extra_body")
    if isinstance(configured_extra, dict):
        extra_body.update(configured_extra)
    if provider_norm == "gemini":
        # If effort is 'none' or not configured, disable thinking tokens for fast per-step answers
        if reasoning_config is None or reasoning_config.get("enabled") is False or effort == "none":
            extra_body.setdefault("thinking_config", {"thinkingBudget": 0, "includeThoughts": False})
        elif effort in ("minimal", "low"):
            extra_body.setdefault("thinking_config", {"thinkingLevel": "low", "includeThoughts": True})
    # JSON mode: only send response_format on OpenAI-compatible providers that won't 400 on it
    if is_json and provider_norm not in ("gemini", "anthropic"):
        extra_body.setdefault("response_format", {"type": "json_object"})
    return extra_body


def _call_timeout(timeout: float, cfg_timeout: Any, *, hard_timeout: bool, use_config_timeout: bool) -> float:
    """Combine with the configured task timeout: the larger wins, unless the caller imposes a hard cap."""
    # use_config_timeout=False (final polish): the caller's own budget is the timeout, as given.
    if use_config_timeout and isinstance(cfg_timeout, (int, float)) and cfg_timeout > 0:
        # A caller-imposed hard cap (Prompt Studio deadlines) wins over a larger config value, so the
        # provider call ends on its own instead of pinning a worker thread past the deadline.
        return min(timeout, float(cfg_timeout)) if hard_timeout else max(timeout, float(cfg_timeout))
    return timeout


def _body_without_json_mode(extra_body: Mapping[str, Any], configured_extra: Any) -> dict[str, Any]:
    retry_body = {k: v for k, v in extra_body.items() if k != "response_format"}
    if isinstance(configured_extra, dict) and "response_format" in configured_extra:
        # Hermes merges auxiliary.<task>.extra_body back into every request, so dropping the key would
        # bring the configured format back; an explicit plain-text format overrides it instead.
        retry_body["response_format"] = {"type": "text"}
    return retry_body


def _default_llm(
    *,
    messages: list[dict[str, str]],
    max_tokens: int,
    timeout: float,
    is_json: bool = False,
    hard_timeout: bool = False,
    use_config_timeout: bool = True,
    model_choice: Mapping[str, Any] | None = None,
) -> tuple[str, str]:
    """Universal Hermes adapter handling reasoning controls and token headroom across all providers."""
    route: dict[str, str] = {}
    task_config = host.auxiliary_task_config(_AUX_TASK)
    provider, model, _, _, _ = host.resolve_route(_AUX_TASK)
    task, task_config, provider, model, effort, explicit = _apply_choice(task_config, provider, model, task_config.get("reasoning_effort"), model_choice)
    provider_norm = (provider or "").strip().lower()
    effort, max_tokens = _effort_and_cap(effort, provider_norm, max_tokens)

    reasoning_config = host.parse_reasoning_effort(effort) if effort else None
    host.check_after_call_helpers()  # a changed helper must not be found after the provider call has been paid for

    extra_body = _provider_body(task_config, provider_norm, effort, reasoning_config, is_json)
    timeout = _call_timeout(timeout, task_config.get("timeout"), hard_timeout=hard_timeout, use_config_timeout=use_config_timeout)
    deadline = time.monotonic() + timeout

    def _call(body: dict[str, Any], budget: float) -> Any:
        return host.call_llm(
            task=task,
            messages=messages,
            max_tokens=max_tokens,
            timeout=budget,
            route_info=route,
            extra_body=body or None,
            reasoning_config=reasoning_config,
            **explicit,
        )

    try:
        response = _call(extra_body, timeout)
    except Exception as exc:
        # Some routes refuse JSON mode (e.g. a provider that only takes json_schema). The prompts already ask
        # for JSON and _json_object reads it from plain text, so retry once without JSON mode, within what is
        # left of the same budget (a retry never restarts the deadline).
        remaining = deadline - time.monotonic()
        if "response_format" not in extra_body or not _rejects_json_mode(exc) or remaining < RETRY_MIN_SECONDS:
            raise
        logger.info("Prompt Studio: route refused JSON mode, retrying without it")
        response = _call(_body_without_json_mode(extra_body, task_config.get("extra_body")), remaining)
    resolved_provider = route.get("provider", provider or "auto")
    resolved_model = route.get("model", model or "default")
    content = _answer_content(response)
    # Keep JSON-aware text intact; use the host's normalization only for non-text content, without reasoning.
    text = content.strip() if isinstance(content, str) else host.extract_content_or_reasoning({"content": content})
    return Reply(text, f"{resolved_provider}/{resolved_model}", _finish_reason(response))


_JSON_MODE_TEXT = ("response_format", "json_object", "structured output", "json_schema", "json mode")


def _rejects_json_mode(exc: BaseException) -> bool:
    """The route refused the JSON-mode request itself (local ValueError or a 400 naming the JSON format)."""
    if not (isinstance(exc, ValueError) or is_provider_bad_request(exc)):
        return False
    # A format marker in a terminal error does not authorize another paid call.
    if provider_error_code(exc) not in ("provider_bad_request", "unavailable"):
        return False
    text = str(exc).lower()
    return any(marker in text for marker in _JSON_MODE_TEXT)


def is_model_not_found(exc: BaseException) -> bool:
    """The provider does not know the model name (404 / "model not found"), e.g. a mistyped pick in Settings.

    Raises ``host.HostIncompatible`` when Hermes' own classifier changed: callers answer ``host_incompatible``.
    """
    if getattr(exc, "status_code", None) == 404 or type(exc).__name__ == "NotFoundError":
        return True
    try:
        return host.is_model_not_found_error(exc)
    except host.HostIncompatible:
        raise
    except Exception:
        return False


def _status(exc: BaseException) -> Any:
    status = getattr(exc, "status_code", None)
    return status if status is not None else getattr(getattr(exc, "response", None), "status_code", None)


def _is_named(exc: BaseException, *names: str) -> bool:
    return any(cls.__name__ in names for cls in type(exc).__mro__)


def is_auth_failed(exc: BaseException) -> bool:
    """The provider does not accept the credentials (401, a wrong or expired API key)."""
    return _status(exc) == 401 or _is_named(exc, "AuthenticationError")


def is_provider_refused(exc: BaseException) -> bool:
    """The provider denies this model to the account/plan (403, e.g. 403 MODEL_NOT_IN_PLAN)."""
    if _status(exc) == 403 or _is_named(exc, "PermissionDeniedError"):
        return True
    text = str(exc).lower()
    return "model_not_in_plan" in text or "not in plan" in text


def is_rate_limited(exc: BaseException) -> bool:
    """The provider throttles the requests (429)."""
    return _status(exc) == 429 or _is_named(exc, "RateLimitError")


def is_provider_timeout(exc: BaseException) -> bool:
    """The provider call timed out on its own (a client timeout, 408 or 504); not the Studio's own deadline."""
    return _status(exc) in (408, 504) or isinstance(exc, TimeoutError) or any(
        cls.__name__.endswith(("Timeout", "TimeoutError", "TimeoutException")) for cls in type(exc).__mro__
    )


# Unambiguous billing failures only: the bare word "billing" also shows up in rate-limit hints, outages and
# parameter names, which are not a matter of credits (/review P2).
_PAYMENT_TEXT = (
    "insufficient_quota", "insufficient credits", "insufficient_credits", "payment required",
    "billing_hard_limit", "credit balance is too low",
)


def is_provider_payment(exc: BaseException) -> bool:
    """The provider refuses for billing reasons (402, no credits, insufficient_quota)."""
    if _status(exc) == 402 or type(exc).__name__ == "PaymentRequiredError":
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _PAYMENT_TEXT)


def is_provider_bad_request(exc: BaseException) -> bool:
    """The provider rejects the request itself (400), e.g. a setting the model or route does not accept."""
    return _status(exc) == 400 or type(exc).__name__ == "BadRequestError"


HOST_INCOMPATIBLE_ERROR = "Hermes changed in a way this Prompt Studio version does not support; update the plugin (details in the Hermes log)"


def is_host_incompatible(exc: BaseException) -> bool:
    """Hermes changed a signature the plugin relies on (by code, so any loaded copy of the host module counts)."""
    return getattr(exc, "code", None) == host.CODE


def check_host() -> None:
    """Raise ``host.HostIncompatible`` when the installed Hermes no longer matches (a missing Hermes is not an error)."""
    host.verify(_AUX_TASK)


# One row per provider failure: (code, test, fixed sentence). The first matching row wins, so the order is the
# precedence: a 429 that names billing is a payment problem (before rate_limited), a 403 stays a refusal even when
# it names billing (before payment), a 401 is always auth_failed. No row matching means "unavailable".
PROVIDER_ERRORS: tuple[tuple[str, Callable[[BaseException], bool], str], ...] = (
    ("model_not_found", is_model_not_found, "model not found"),
    ("auth_failed", is_auth_failed, "auth failed"),
    ("provider_refused", is_provider_refused, "provider refused"),
    ("provider_payment", is_provider_payment, "provider payment"),
    ("provider_bad_request", is_provider_bad_request, "provider bad request"),
    ("rate_limited", is_rate_limited, "rate limited"),
    ("provider_timeout", is_provider_timeout, "provider timeout"),
)
UNAVAILABLE_SENTENCE = "model unavailable"


def provider_error_code(exc: BaseException) -> str:
    """Error code for a failed provider call (first matching row of ``PROVIDER_ERRORS``); the provider text is never returned.

    Used by /suggest, /compose and /context alike. ``host_incompatible`` when Hermes changed under the classifier.
    """
    if is_host_incompatible(exc):
        return host.CODE
    try:
        for code, matches, _ in PROVIDER_ERRORS:
            if matches(exc):
                return code
    except host.HostIncompatible:
        logger.warning("Prompt Studio: Hermes changed, cannot tell a missing model from other errors", exc_info=True)
        return host.CODE
    return "unavailable"


def provider_error_sentence(code: str) -> str:
    """The fixed sentence of a provider error code (no provider text, no class name)."""
    return next((sentence for row, _, sentence in PROVIDER_ERRORS if row == code), UNAVAILABLE_SENTENCE)


def get_model_label(model_choice: Mapping[str, Any] | None = None) -> str:
    """Best-effort configured (or chosen) auxiliary route for health/fallback responses."""
    chosen = _choice(model_choice)
    if chosen:
        return f"{chosen[0] or 'auto'}/{chosen[1]}"
    try:
        provider, model, _, _, _ = host.resolve_route(_AUX_TASK)
        return f"{provider or 'auto'}/{model or 'default'}"
    except Exception:
        return "auto/default"


def _invoke(
    llm: Callable[..., Any] | None,
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    timeout: float,
    is_json: bool = False,
    hard_timeout: bool = False,
    use_config_timeout: bool = True,
    model_choice: Mapping[str, Any] | None = None,
) -> Reply:
    # No temperature: the model's sampling stays as Hermes configures it for that model.
    if llm is not None:
        try:
            result = llm(messages=messages, max_tokens=max_tokens, timeout=timeout, is_json=is_json)
        except TypeError:
            result = llm(messages=messages, max_tokens=max_tokens, timeout=timeout)
    else:
        result = _default_llm(messages=messages, max_tokens=max_tokens, timeout=timeout, is_json=is_json, hard_timeout=hard_timeout, use_config_timeout=use_config_timeout, model_choice=model_choice)

    if isinstance(result, tuple) and len(result) >= 2:
        return Reply(str(result[0] or ""), str(result[1] or get_model_label(model_choice)), getattr(result, "finish_reason", ""))
    if isinstance(result, Mapping):
        return Reply(str(result.get("text") or result.get("content") or ""), str(result.get("model") or get_model_label(model_choice)))
    return Reply(str(result or ""), get_model_label(model_choice))
