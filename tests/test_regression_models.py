"""REG-MODELS: adversarial per-request model/config isolation, without a real host.

Contracts: docs/CONTRACT.md model_choice and no-sampling rules. Only Hermes' SDK
boundary is doubled; the adapter, route validation and engine remain real.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import llm_adapter as adapter
import plugin_api


@pytest.fixture
def models_host(monkeypatch):
    config = {
        "provider": "openai",
        "model": "configured-model",
        "base_url": "https://configured.invalid/v1",
        "api_key": "REG-MODELS-DUMMY-NOT-A-CREDENTIAL",
        "timeout": 7,
        "reasoning_effort": "medium",
        "extra_body": {"configured_only": {"tenant": "local-test"}},
    }
    calls = []
    fake = types.ModuleType("agent.auxiliary_client")

    def call_llm(**kwargs):
        calls.append(deepcopy(kwargs))
        provider = kwargs.get("provider") or config["provider"]
        model = kwargs.get("model") or config["model"]
        kwargs["route_info"].update(provider=provider, model=model)
        return {"choices": [{"message": {"content": '{"value":"A useful answer","reason":"ok","prompt":"A useful final prompt with enough text.","notes":"ok"}'}, "finish_reason": "stop"}]}

    fake.call_llm = call_llm
    fake._get_auxiliary_task_config = lambda task: config
    fake._resolve_task_provider_model = lambda task: (config["provider"], config["model"], None, None, None)
    fake.extract_content_or_reasoning = lambda response: response.get("content", "")
    fake._is_model_not_found_error = lambda exc: False
    constants = types.ModuleType("hermes_constants")
    constants.parse_reasoning_effort = lambda value: {"enabled": value != "none", "effort": value}
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    return types.SimpleNamespace(config=config, calls=calls, sdk=fake)


def models_call(choice=None):
    return adapter._default_llm(
        messages=[{"role": "user", "content": "A local test"}],
        max_tokens=500, timeout=20, hard_timeout=True, is_json=True,
        model_choice=choice,
    )


def test_reg_models_provider_effort_switches_do_not_poison_the_next_call(models_host):
    """A -> Gemini -> Anthropic -> A/config uses only each request's settings."""
    original = deepcopy(models_host.config)
    choices = [
        {"provider": "openai", "model": "helper-a", "effort": "high"},
        {"provider": "gemini", "model": "context-b", "effort": "none"},
        {"provider": "anthropic", "model": "helper-c", "effort": "low"},
        None,
    ]
    replies = [models_call(choice) for choice in choices]
    assert [reply[1] for reply in replies] == [
        "openai/helper-a", "gemini/context-b", "anthropic/helper-c", "openai/configured-model",
    ]
    calls = models_host.calls
    assert [call["task"] for call in calls] == ["prompt_studio", None, None, "prompt_studio"]
    assert [call["reasoning_config"]["effort"] for call in calls] == ["high", "none", "low", "medium"]
    assert [call["max_tokens"] for call in calls] == [8192, 500, 500, 4096]
    assert [call["timeout"] for call in calls] == [7, 7, 7, 7]
    assert calls[0]["extra_body"] == calls[3]["extra_body"] == {
        "configured_only": {"tenant": "local-test"}, "response_format": {"type": "json_object"},
    }
    assert calls[1]["extra_body"] == {"thinking_config": {"thinkingBudget": 0, "includeThoughts": False}}
    assert calls[2]["extra_body"] is None
    assert "provider" not in calls[3] and "model" not in calls[3]
    for call in calls:
        assert not {"base_url", "api_key", "temperature", "top_p"}.intersection(call)
    assert models_host.config == original


def test_reg_models_foreign_provider_json_retry_stays_detached_from_config(models_host):
    """Retry after a provider switch must not resurrect the old task or JSON body."""
    original = deepcopy(models_host.config)
    transport = models_host.sdk.call_llm
    attempts = []

    def reject_once(**kwargs):
        attempts.append(deepcopy(kwargs))
        if len(attempts) == 1:
            raise ValueError("response_format json_object unsupported")
        return transport(**kwargs)

    models_host.sdk.call_llm = reject_once
    reply = models_call({"provider": "openrouter", "model": "helper-other", "effort": "none"})
    assert reply[1] == "openrouter/helper-other"
    assert len(attempts) == 2
    assert [call["extra_body"] for call in attempts] == [{"response_format": {"type": "json_object"}}, None]
    for call in attempts:
        assert call["task"] is None
        assert (call["provider"], call["model"]) == ("openrouter", "helper-other")
        assert call["reasoning_config"] == {"enabled": False, "effort": "none"}
        assert call["max_tokens"] == 500
        assert not {"base_url", "api_key", "temperature", "top_p"}.intersection(call)
    assert 0 < attempts[1]["timeout"] <= attempts[0]["timeout"] == 7
    assert models_host.config == original
    models_host.sdk.call_llm = transport
    assert models_call()[1] == "openai/configured-model"
    assert models_host.calls[-1]["extra_body"]["configured_only"] == original["extra_body"]["configured_only"]


@pytest.mark.parametrize("empty_model", ["", " \t\n", None])
def test_reg_models_empty_choice_after_explicit_choice_restores_config(models_host, empty_model):
    """Empty model makes even a conflicting provider/effort irrelevant (adapter contract)."""
    models_call({"provider": "gemini", "model": "context-before", "effort": "none"})
    assert models_call({"provider": "anthropic", "model": empty_model, "effort": "ultra"})[1] == "openai/configured-model"
    call = models_host.calls[-1]
    assert call["task"] == "prompt_studio"
    assert "provider" not in call and "model" not in call
    assert call["reasoning_config"] == {"enabled": True, "effort": "medium"}
    assert call["max_tokens"] == 4096
    assert call["extra_body"]["configured_only"] == {"tenant": "local-test"}


@pytest.fixture
def models_client():
    app = FastAPI()
    app.include_router(plugin_api.router)
    with TestClient(app) as client:
        yield client


MODELS_ROUTE_BODIES = [
    ("/suggest", {"intent": "Write an implementation plan", "field": {"question": "What constraints apply?"}}),
    ("/compose", {"intent": "Write an implementation plan", "baseline": "A useful baseline plan for the implementation."}),
    ("/context", {"session_id": "reg-models-session", "profile": "test"}),
]


@pytest.mark.parametrize("route,body", MODELS_ROUTE_BODIES)
@pytest.mark.parametrize("invalid", [
    [], "not-a-choice", {"model": 123}, {"provider": []},
    {"model": "m", "effort": "HIGH"}, {"model": "m", "effort": None},
    {"provider": "p" * 81}, {"model": "m" * 201},
])
def test_reg_models_malformed_choice_is_rejected_before_loading_host(monkeypatch, models_client, route, body, invalid):
    """All routes fail closed on wrong types/limits, before any engine/store can open."""
    loaded = []

    def forbidden_load(*args):
        loaded.append(args)
        raise AssertionError("malformed model_choice reached an engine")

    monkeypatch.setattr(plugin_api, "_load", forbidden_load)
    response = models_client.post(route, json={**body, "model_choice": invalid})
    assert response.status_code == 422, response.text
    assert loaded == []
    assert any(item["loc"][:2] == ["body", "model_choice"] for item in response.json()["detail"])


@pytest.mark.parametrize("route,body", MODELS_ROUTE_BODIES[:2])
def test_reg_models_request_cannot_inject_endpoint_or_extra_body(models_host, models_client, route, body):
    """Real route -> real engine -> real adapter drops unknown per-request host overrides."""
    response = models_client.post(route, json={
        **body,
        "model_choice": {
            "provider": "anthropic", "model": "chosen-model", "effort": "none",
            "base_url": "https://request-override.invalid/v1",
            "api_key": "REG-MODELS-DUMMY-REQUEST",
            "extra_body": {"request_only": True},
            "temperature": 0.9, "top_p": 0.3,
        },
    })
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True, response.json()
    assert response.json()["model"] == "anthropic/chosen-model"
    assert len(models_host.calls) == 1
    call = models_host.calls[0]
    assert call["task"] is None and call["extra_body"] is None
    assert not {"base_url", "api_key", "temperature", "top_p"}.intersection(call)
    assert call["reasoning_config"] == {"enabled": False, "effort": "none"}
