from __future__ import annotations

import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import llm_adapter as adapter


def test_json_object_from_plain_fenced_and_thinking_output():
    payload = {"value": "Equilibrada", "reason": "ok"}
    assert adapter._json_object(json.dumps(payload)) == payload
    assert adapter._json_object("Aqui:\n```json\n" + json.dumps(payload) + "\n```") == payload
    thinking = '<think>talvez {"example": false}</think>\n' + json.dumps(payload)
    assert adapter._json_object(thinking) == payload


def test_json_object_prefers_the_studio_keys_and_rejects_garbage():
    text = 'nota {"other": 1} e depois {"prompt": "Faça X."}'
    assert adapter._json_object(text) == {"prompt": "Faça X."}
    assert adapter._json_object("sem json aqui") is None
    assert adapter._json_object(None) is None


def test_invoke_accepts_tuple_mapping_and_plain_results():
    assert adapter._invoke(lambda **_: ("texto", "p/m"), [], max_tokens=10, timeout=1) == ("texto", "p/m")
    assert adapter._invoke(lambda **_: {"text": "t", "model": "p/m"}, [], max_tokens=10, timeout=1) == ("t", "p/m")
    # Older test doubles without is_json still work.
    assert adapter._invoke(lambda messages, temperature, max_tokens, timeout: "t", [], max_tokens=10, timeout=1, is_json=True)[0] == "t"


def test_routes_through_the_prompt_studio_task_only():
    assert adapter._AUX_TASK == "prompt_studio"
    assert not hasattr(adapter, "_aux_task_key") and not hasattr(adapter, "_LEGACY_AUX_TASKS")


def test_hard_timeout_caps_the_configured_timeout(monkeypatch):
    captured = {}
    fake = types.ModuleType("agent.auxiliary_client")
    fake.call_llm = lambda **kw: captured.update(kw) or {"choices": []}
    fake.extract_content_or_reasoning = lambda r: "{}"
    fake._get_auxiliary_task_config = lambda task: {"timeout": 60}
    fake._resolve_task_provider_model = lambda *a, **k: ("p", "m", None, None, None)
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = lambda v: None
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)
    adapter._default_llm(messages=[], temperature=0, max_tokens=10, timeout=20, hard_timeout=True)
    assert captured["timeout"] == 20
    adapter._default_llm(messages=[], temperature=0, max_tokens=10, timeout=20)
    assert captured["timeout"] == 60



# --- CT-08: provider branches of _default_llm, get_model_label fallback, _json_object edge cases.
def _fake_hermes(monkeypatch, provider, config, effort_parse=lambda v: {"enabled": v != "none", "effort": v}):
    captured = {}
    fake = types.ModuleType("agent.auxiliary_client")

    def call_llm(**kw):
        captured.update(kw)
        kw["route_info"].update({"provider": "routed", "model": "rm"})
        return {"choices": []}

    fake.call_llm = call_llm
    fake.extract_content_or_reasoning = lambda r: "out"
    fake._get_auxiliary_task_config = lambda task: config
    fake._resolve_task_provider_model = lambda *a, **k: (provider, "m", None, None, None)
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = effort_parse
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)
    return captured


def _call(**kw):
    return adapter._default_llm(messages=[], temperature=0, max_tokens=10, timeout=5, **kw)


def test_configured_extra_body_is_forwarded_and_route_info_names_the_model(monkeypatch):
    captured = _fake_hermes(monkeypatch, "openrouter", {"extra_body": {"top_k": 3}})
    assert _call() == ("out", "routed/rm")
    assert captured["extra_body"] == {"top_k": 3} and captured["reasoning_config"] is None


def test_gemini_without_effort_disables_thinking_and_skips_response_format(monkeypatch):
    captured = _fake_hermes(monkeypatch, "Gemini", {})
    _call(is_json=True)
    assert captured["extra_body"] == {"thinking_config": {"thinkingBudget": 0, "includeThoughts": False}}


def test_gemini_low_effort_uses_low_thinking_level(monkeypatch):
    captured = _fake_hermes(monkeypatch, "gemini", {"reasoning_effort": "low"})
    _call()
    assert captured["extra_body"] == {"thinking_config": {"thinkingLevel": "low", "includeThoughts": True}}
    assert captured["reasoning_config"] == {"enabled": True, "effort": "low"}


def test_gemini_high_effort_leaves_thinking_to_the_provider(monkeypatch):
    captured = _fake_hermes(monkeypatch, "gemini", {"reasoning_effort": "high"})
    _call()
    assert captured["extra_body"] is None


def test_json_mode_sends_response_format_only_on_openai_compatible_providers(monkeypatch):
    captured = _fake_hermes(monkeypatch, "openai", {})
    _call(is_json=True)
    assert captured["extra_body"] == {"response_format": {"type": "json_object"}}
    captured = _fake_hermes(monkeypatch, "anthropic", {})
    _call(is_json=True)
    assert captured["extra_body"] is None


def test_use_config_timeout_false_keeps_the_callers_timeout(monkeypatch):
    captured = _fake_hermes(monkeypatch, "p", {"timeout": 60})
    _call(use_config_timeout=False)
    assert captured["timeout"] == 5


def test_get_model_label_reports_route_and_falls_back_without_hermes(monkeypatch):
    _fake_hermes(monkeypatch, None, {})
    assert adapter.get_model_label() == "auto/m"
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", None)  # import now raises
    assert adapter.get_model_label() == "auto/default"


def test_json_object_edge_cases():
    nested = {"value": {"inner": {"deep": [1, {"x": 2}]}}}
    assert adapter._json_object("Sure! Here it is: " + json.dumps(nested) + " hope it helps") == nested
    assert adapter._json_object("```\n" + json.dumps(nested) + "\n```") == nested
    # Invalid JSON inside a fence falls through to the scan, which finds the valid object later on.
    assert adapter._json_object('```json\n{bad json}\n``` then {"prompt": "p"}') == {"prompt": "p"}
    assert adapter._json_object('{"a": 1,') is None
    assert adapter._json_object("[1, 2]") is None  # top-level non-object
    assert adapter._json_object('x {"a": 1} y') == {"a": 1}  # no Studio keys: first candidate
    assert adapter._invoke(lambda **_: None, [], max_tokens=1, timeout=1)[0] == ""
