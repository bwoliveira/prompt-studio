"""Model adapter for the Prompt Studio routes.

Routes every call through Hermes' auxiliary client under the plugin's ``auxiliary.prompt_studio`` task,
with per-provider reasoning/JSON adaptation and a hard timeout the Studio deadlines rely on.
Pure helpers (JSON extraction, task-key resolution) are importable without Hermes for tests.
"""
from __future__ import annotations

import json
import logging
import re
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


def _json_object(text: str) -> dict[str, Any] | None:
    """Find the best valid JSON object in prose, fences, or thinking output."""
    if not isinstance(text, str):
        return None
    cleaned = _strip_thinking(text)

    # 1. Direct JSON parse
    try:
        val = json.loads(cleaned)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass

    # 2. Markdown fence ```json ... ```
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    if fence_match:
        try:
            val = json.loads(fence_match.group(1))
            if isinstance(val, dict):
                return val
        except json.JSONDecodeError:
            pass

    # 3. Scan across '{' occurrences with raw_decode
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for match in re.finditer(r"\{", cleaned):
        try:
            value, _ = decoder.raw_decode(cleaned[match.start():])
            if isinstance(value, dict):
                candidates.append(value)
        except json.JSONDecodeError:
            continue

    if not candidates:
        return None

    # Prefer a candidate with the keys the Studio routes expect.
    for cand in candidates:
        if "value" in cand or "prompt" in cand:
            return cand

    return candidates[0]


def _choice(model_choice: Mapping[str, Any] | None) -> tuple[str, str, str] | None:
    """(provider, model, effort) of a per-task model choice, or None when no model is chosen
    (empty model = use the ``auxiliary.prompt_studio`` config, exactly as before)."""
    if not isinstance(model_choice, Mapping):
        return None
    model = _clean_text(model_choice.get("model"))
    if not model:
        return None
    return _clean_text(model_choice.get("provider")), model, _clean_text(model_choice.get("effort")).lower()


def _default_llm(
    *,
    messages: list[dict[str, str]],
    temperature: float,
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

    response = call_llm(
        task=task,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        route_info=route,
        extra_body=extra_body or None,
        reasoning_config=reasoning_config,
        **explicit,
    )
    resolved_provider = route.get("provider", provider or "auto")
    resolved_model = route.get("model", model or "default")
    return extract_content_or_reasoning(response), f"{resolved_provider}/{resolved_model}"


def is_model_not_found(exc: BaseException) -> bool:
    """The provider does not know the model name (404 / "model not found"), e.g. a mistyped pick in Settings."""
    if getattr(exc, "status_code", None) == 404 or type(exc).__name__ == "NotFoundError":
        return True
    try:
        from agent.auxiliary_client import _is_model_not_found_error
        return bool(_is_model_not_found_error(exc))
    except Exception:
        return False


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
) -> tuple[str, str]:
    if llm is not None:
        try:
            result = llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout, is_json=is_json)
        except TypeError:
            result = llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout)
    else:
        result = _default_llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout, is_json=is_json, hard_timeout=hard_timeout, use_config_timeout=use_config_timeout, model_choice=model_choice)

    if isinstance(result, tuple) and len(result) >= 2:
        return str(result[0] or ""), str(result[1] or get_model_label(model_choice))
    if isinstance(result, Mapping):
        return str(result.get("text") or result.get("content") or ""), str(result.get("model") or get_model_label(model_choice))
    return str(result or ""), get_model_label(model_choice)
