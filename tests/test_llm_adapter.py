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
