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

logger = logging.getLogger(__name__)

# Auxiliary task registered by __init__.register(); its block is ``auxiliary.prompt_studio``.
_AUX_TASK = "prompt_studio"


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _strip_thinking(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


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

    The host's ``extract_content_or_reasoning`` falls back to the reasoning fields when the content is empty;
    handing it a bare ``{"content": ...}`` message keeps that fallback (and its think-block stripping) from
    turning JSON inside the thinking into the reply.
    """
    choices = response.get("choices") if isinstance(response, Mapping) else getattr(response, "choices", None)
    first = choices[0] if choices else response
    message = first.get("message") if isinstance(first, Mapping) else getattr(first, "message", first)
    return message.get("content") if isinstance(message, Mapping) else getattr(message, "content", None)


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
    """Find the best valid JSON object in prose, fences, or thinking output."""
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
    from agent.auxiliary_client import (
        call_llm,
        extract_content_or_reasoning,
        _get_auxiliary_task_config,
        _resolve_task_provider_model,
    )
    from hermes_constants import parse_reasoning_effort

    route: dict[str, str] = {}
    task = _AUX_TASK
    task_config = _get_auxiliary_task_config(task)
    provider, model, _, _, _ = _resolve_task_provider_model(task)
    effort = task_config.get("reasoning_effort")
    explicit: dict[str, Any] = {}
    chosen = _choice(model_choice)
    if chosen:
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
    provider_norm = (provider or "").strip().lower()
    effort, max_tokens = _effort_and_cap(effort, provider_norm, max_tokens)

    reasoning_config = parse_reasoning_effort(effort) if effort else None

    extra_body: dict[str, Any] = {}
    configured_extra = task_config.get("extra_body")
    if isinstance(configured_extra, dict):
        extra_body.update(configured_extra)

    # Provider-specific thinking / reasoning adaptation
    if provider_norm == "gemini":
        # If effort is 'none' or not configured, disable thinking tokens for fast per-step answers
        if reasoning_config is None or reasoning_config.get("enabled") is False or effort == "none":
            extra_body.setdefault("thinking_config", {"thinkingBudget": 0, "includeThoughts": False})
        elif effort in ("minimal", "low"):
            extra_body.setdefault("thinking_config", {"thinkingLevel": "low", "includeThoughts": True})

    # JSON mode: only send response_format on OpenAI-compatible providers that won't 400 on it
    if is_json and provider_norm not in ("gemini", "anthropic"):
        extra_body.setdefault("response_format", {"type": "json_object"})

    # Combine with the configured task timeout: the larger wins, unless the caller imposes a hard cap.
    cfg_timeout = task_config.get("timeout")
    # use_config_timeout=False (final polish): the caller's own budget is the timeout, as given.
    if use_config_timeout and isinstance(cfg_timeout, (int, float)) and cfg_timeout > 0:
        # A caller-imposed hard cap (Prompt Studio deadlines) wins over a larger config value, so the
        # provider call ends on its own instead of pinning a worker thread past the deadline.
        timeout = min(timeout, float(cfg_timeout)) if hard_timeout else max(timeout, float(cfg_timeout))

    deadline = time.monotonic() + timeout

    def _call(body: dict[str, Any], budget: float) -> Any:
        return call_llm(
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
        retry_body = {k: v for k, v in extra_body.items() if k != "response_format"}
        if isinstance(configured_extra, dict) and "response_format" in configured_extra:
            # Hermes merges auxiliary.<task>.extra_body back into every request, so dropping the key would
            # bring the configured format back; an explicit plain-text format overrides it instead.
            retry_body["response_format"] = {"type": "text"}
        response = _call(retry_body, remaining)
    resolved_provider = route.get("provider", provider or "auto")
    resolved_model = route.get("model", model or "default")
    return Reply(extract_content_or_reasoning({"content": _answer_content(response)}), f"{resolved_provider}/{resolved_model}", _finish_reason(response))


_JSON_MODE_TEXT = ("response_format", "json_object", "structured output", "json_schema", "json mode")


def _rejects_json_mode(exc: BaseException) -> bool:
    """The route refused the JSON-mode request itself (local ValueError or a 400 naming the JSON format)."""
    if not (isinstance(exc, ValueError) or is_provider_bad_request(exc)):
        return False
    text = str(exc).lower()
    return any(marker in text for marker in _JSON_MODE_TEXT)


def is_model_not_found(exc: BaseException) -> bool:
    """The provider does not know the model name (404 / "model not found"), e.g. a mistyped pick in Settings."""
    if getattr(exc, "status_code", None) == 404 or type(exc).__name__ == "NotFoundError":
        return True
    try:
        from agent.auxiliary_client import _is_model_not_found_error
        return bool(_is_model_not_found_error(exc))
    except Exception:
        return False


def is_provider_refused(exc: BaseException) -> bool:
    """The provider denies this model to the account/key/plan (401/403, e.g. 403 MODEL_NOT_IN_PLAN)."""
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 403) or type(exc).__name__ in ("AuthenticationError", "PermissionDeniedError"):
        return True
    text = str(exc).lower()
    return "model_not_in_plan" in text or "not in plan" in text


# Unambiguous billing failures only: the bare word "billing" also shows up in rate-limit hints, outages and
# parameter names, which are not a matter of credits (/review P2).
_PAYMENT_TEXT = (
    "insufficient_quota", "insufficient credits", "insufficient_credits", "payment required",
    "billing_hard_limit", "credit balance is too low",
)


def _status(exc: BaseException) -> Any:
    status = getattr(exc, "status_code", None)
    return status if status is not None else getattr(getattr(exc, "response", None), "status_code", None)


def is_provider_payment(exc: BaseException) -> bool:
    """The provider refuses for billing reasons (402, no credits, insufficient_quota)."""
    if _status(exc) == 402 or type(exc).__name__ == "PaymentRequiredError":
        return True
    text = str(exc).lower()
    return any(marker in text for marker in _PAYMENT_TEXT)


def is_provider_bad_request(exc: BaseException) -> bool:
    """The provider rejects the request itself (400), e.g. a setting the model or route does not accept."""
    return _status(exc) == 400 or type(exc).__name__ == "BadRequestError"


def provider_error_code(exc: BaseException) -> str:
    """Error code for a failed provider call, most specific first; the provider text is never returned."""
    if is_model_not_found(exc):
        return "model_not_found"
    if is_provider_refused(exc):
        return "provider_refused"
    if is_provider_payment(exc):
        return "provider_payment"
    if is_provider_bad_request(exc):
        return "provider_bad_request"
    return "unavailable"


def get_model_label(model_choice: Mapping[str, Any] | None = None) -> str:
    """Best-effort configured (or chosen) auxiliary route for health/fallback responses."""
    chosen = _choice(model_choice)
    if chosen:
        return f"{chosen[0] or 'auto'}/{chosen[1]}"
    try:
        from agent.auxiliary_client import _resolve_task_provider_model
        provider, model, _, _, _ = _resolve_task_provider_model(_AUX_TASK)
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
