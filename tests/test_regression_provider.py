"""REG-PROVIDER: exercise the real engine/adapter against a controlled Hermes SDK.

No installed Hermes, provider, credentials or session database is used. Events release
late workers explicitly; the fake monotonic clock is scoped to the loaded modules.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import threading
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODEL = "openai/reg-provider-model"
CHOICE = {"provider": "openai", "model": "reg-provider-model"}
PAYLOADS = {
    "suggest": {
        "intent": "Crie um app para registrar gastos da casa",
        "target": "opus",
        "field": {"id": "context", "kind": "text", "question": "Qual contexto?"},
        "model_choice": CHOICE,
    },
    "compose": {
        "intent": "Crie um app para registrar gastos da casa",
        "target": "opus",
        "answers": [],
        "baseline": "TASK\nCrie um app para registrar gastos da casa.\n",
        "model_choice": CHOICE,
    },
}


def reg_provider_response(route, value="RECOVERED REG-PROVIDER resposta atual", finish_reason="stop"):
    content = json.dumps({"value" if route == "suggest" else "prompt": value})
    return {"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]}


@pytest.fixture
def reg_provider_sdk(monkeypatch):
    """Only the external Hermes SDK is replaced; engine, adapter and host checks stay real."""
    spec = importlib.util.spec_from_file_location(
        "reg_provider_engine", ROOT / "dashboard" / "suggest_engine.py"
    )
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    sdk = types.ModuleType("agent.auxiliary_client")
    sdk._get_auxiliary_task_config = lambda task: {"provider": "openai"}
    sdk._resolve_task_provider_model = lambda task: ("openai", "reg-provider-model", None, None, None)
    sdk._is_model_not_found_error = lambda exc: getattr(exc, "status_code", None) == 404
    sdk.extract_content_or_reasoning = lambda response: response.get("content", "") or ""
    calls = []
    behavior = {"run": lambda **kw: reg_provider_response("suggest")}

    def call_llm(**kw):
        calls.append(kw)
        kw["route_info"].update({"provider": "openai", "model": "reg-provider-model"})
        return behavior["run"](**kw)

    sdk.call_llm = call_llm
    constants = types.ModuleType("hermes_constants")
    constants.parse_reasoning_effort = lambda effort: {"enabled": True, "effort": effort}
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", sdk)
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    try:
        yield engine, behavior, calls
    finally:
        # Tests release held SDK calls in their own finally before this fixture joins workers.
        engine._EXECUTOR.shutdown(wait=True, cancel_futures=True)
        engine._COMPOSE_EXECUTOR.shutdown(wait=True, cancel_futures=True)


@pytest.mark.parametrize("route", ["suggest", "compose"])
@pytest.mark.parametrize("late_outcome", ["resolve", "reject"])
def test_reg_provider_deadline_then_provider_timeout_then_recovery_isolates_late_worker(
    reg_provider_sdk, route, late_outcome
):
    engine, behavior, calls = reg_provider_sdk
    entered = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    invoke = getattr(engine, route)

    def held(**kw):
        entered.set()
        try:
            assert release.wait(3), "test did not release the old provider call"
            if late_outcome == "reject":
                raise TimeoutError("late provider timeout with response_format in its detail")
            return reg_provider_response(route, "STALE REG-PROVIDER resposta da chamada antiga")
        finally:
            finished.set()

    behavior["run"] = held
    try:
        local = invoke(PAYLOADS[route], deadline=0.05)
        assert entered.is_set(), "the actual provider worker must start before its wall-clock deadline"
        assert local["ok"] is False and local["code"] == "timeout"
        assert local["model"] == MODEL
        assert not finished.is_set(), "the wall-clock response returned without waiting for transport"
        local_snapshot = dict(local)
        assert len(calls) == 1

        def provider_timeout(**kw):
            raise TimeoutError("the provider itself timed out; response_format=json_object")

        behavior["run"] = provider_timeout
        provider = invoke(PAYLOADS[route], deadline=2)
        assert provider["ok"] is False and provider["code"] == "provider_timeout"
        assert provider["model"] == MODEL
        assert len(calls) == 2, "neither kind of timeout is automatically retried"

        behavior["run"] = lambda **kw: reg_provider_response(route)
        recovered = invoke(PAYLOADS[route], deadline=2)
        assert recovered["ok"] is True
        value_key = "value" if route == "suggest" else "prompt"
        assert recovered[value_key] == "RECOVERED REG-PROVIDER resposta atual"
        recovered_snapshot = dict(recovered)
        assert len(calls) == 3, "a new request recovers while the timed-out worker is still pending"
        release.set()
        assert finished.wait(2), "the late worker was released and finished"
        # Join the real executor so the no-late-retry assertion cannot race worker cleanup.
        executor = engine._EXECUTOR if route == "suggest" else engine._COMPOSE_EXECUTOR
        executor.shutdown(wait=True)
        assert local == local_snapshot
        assert recovered == recovered_snapshot
        assert len(calls) == 3, "a discarded late success/failure cannot enqueue another provider call"
    finally:
        release.set()


class RegProviderStatusError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


@pytest.mark.parametrize("route", ["suggest", "compose"])
@pytest.mark.parametrize("status,detail,code", [
    (401, "invalid key; response_format=json_object", "auth_failed"),
    (402, "payment required; response_format=json_object", "provider_payment"),
    (403, "MODEL_NOT_IN_PLAN; response_format=json_object", "provider_refused"),
    (404, "model not found; response_format=json_object", "model_not_found"),
    (429, "rate limit reached; response_format=json_object", "rate_limited"),
    (504, "upstream timeout; response_format=json_object", "provider_timeout"),
    (400, "insufficient_quota; request used response_format=json_object", "provider_payment"),
], ids=["auth", "payment", "plan", "missing-model", "rate-limit", "provider-timeout", "billing-400"])
def test_reg_provider_nonretryable_error_with_json_marker_is_not_a_format_retry(
    reg_provider_sdk, route, status, detail, code
):
    engine, behavior, calls = reg_provider_sdk

    def fail(**kw):
        raise RegProviderStatusError(status, detail)

    behavior["run"] = fail
    result = getattr(engine, route)(PAYLOADS[route], deadline=3)
    assert result["ok"] is False and result["code"] == code
    assert result["model"] == MODEL
    assert detail not in result["error"], "provider detail is not disclosed to the client"
    assert len(calls) == 1, "a terminal provider error is not JSON-mode refusal merely because its detail names response_format"


@pytest.mark.parametrize("route", ["suggest", "compose"])
def test_reg_provider_empty_retry_then_format_fallback_share_the_original_budget(
    reg_provider_sdk, monkeypatch, route
):
    engine, behavior, calls = reg_provider_sdk
    now = [1000.0]
    clock = types.SimpleNamespace(monotonic=lambda: now[0])
    monkeypatch.setattr(engine, "time", clock)
    monkeypatch.setattr(engine._llm, "time", clock)

    def script(**kw):
        now[0] += 2.0
        if len(calls) == 1:
            return {"choices": [{"message": {"content": ""}, "finish_reason": "content_filter"}]}
        if len(calls) == 2:
            raise RegProviderStatusError(400, "response_format json_object is not supported")
        return reg_provider_response(route)

    behavior["run"] = script
    result = getattr(engine, route)(PAYLOADS[route], deadline=12)
    assert result["ok"] is True
    assert result["model"] == MODEL
    assert len(calls) == 3, "one permitted empty retry, then one permitted format fallback"
    assert [call["timeout"] for call in calls] == [12, 10, 8], "neither retry layer restarts the original deadline"
    assert [call["extra_body"] for call in calls] == [
        {"response_format": {"type": "json_object"}},
        {"response_format": {"type": "json_object"}},
        None,
    ]
    assert all("temperature" not in call and "top_p" not in call for call in calls)


@pytest.mark.parametrize("route", ["suggest", "compose"])
@pytest.mark.parametrize("name,status,detail,code", [
    ("NotFoundError", 400, "MODEL_NOT_IN_PLAN; insufficient_quota", "model_not_found"),
    ("AuthenticationError", 400, "MODEL_NOT_IN_PLAN; insufficient_quota", "auth_failed"),
    ("PermissionDeniedError", 400, "insufficient_quota", "provider_refused"),
    ("BadRequestError", 400, "MODEL_NOT_IN_PLAN; insufficient_quota", "provider_refused"),
    ("ValueError", None, "insufficient_quota", "provider_payment"),
    ("ValueError", None, "MODEL_NOT_IN_PLAN", "provider_refused"),
])
def test_reg_provider_terminal_precedence_wins_over_json_retry(reg_provider_sdk, route, name, status, detail, code):
    engine, behavior, calls = reg_provider_sdk
    error = type(name, (ValueError if status is None else Exception,), {})(detail + "; response_format=json_object")
    if status is not None:
        error.status_code = status

    def fail(**kw):
        raise error

    behavior["run"] = fail
    out = getattr(engine, route)(PAYLOADS[route], deadline=3)
    assert out["ok"] is False and out["code"] == code
    assert out["model"] == MODEL
    assert detail not in out["error"]
    assert len(calls) == 1, "the shared classifier's terminal result must take precedence over format fallback"
