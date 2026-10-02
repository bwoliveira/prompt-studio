from __future__ import annotations

import json

import pytest
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
    assert adapter._invoke(lambda messages, max_tokens, timeout: "t", [], max_tokens=10, timeout=1, is_json=True)[0] == "t"


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
    fake._is_model_not_found_error = lambda exc: False  # checked before the call, like the extractor
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = lambda v: None
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)
    adapter._default_llm(messages=[], max_tokens=10, timeout=20, hard_timeout=True)
    assert captured["timeout"] == 20
    adapter._default_llm(messages=[], max_tokens=10, timeout=20)
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
    fake._is_model_not_found_error = lambda exc: False  # checked before the call, like the extractor
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = effort_parse
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)
    return captured


def _call(**kw):
    return adapter._default_llm(messages=[], max_tokens=10, timeout=5, **kw)


def test_configured_extra_body_is_forwarded_and_route_info_names_the_model(monkeypatch):
    captured = _fake_hermes(monkeypatch, "openrouter", {"extra_body": {"top_k": 3}})
    assert _call() == ("out", "routed/rm")
    # No effort configured: the plugin asks for "low" (lote 3 item 1), not the provider default.
    assert captured["extra_body"] == {"top_k": 3} and captured["reasoning_config"] == {"enabled": True, "effort": "low"}


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


# --- CX-1: per-task model choice (provider/model/effort) on the helper and context calls.
def test_empty_model_choice_keeps_todays_call(monkeypatch):
    config = {"reasoning_effort": "low", "extra_body": {"top_k": 3}}
    before = _fake_hermes(monkeypatch, "openrouter", config)
    _call()
    before = dict(before)
    for choice in (None, {}, {"provider": "anthropic", "model": "", "effort": "high"}):
        captured = _fake_hermes(monkeypatch, "openrouter", config)
        _call(model_choice=choice)
        assert captured == {**before, "route_info": captured["route_info"]}
        assert captured["task"] == "prompt_studio" and "provider" not in captured and "model" not in captured


def test_model_choice_is_forwarded_with_its_effort(monkeypatch):
    captured = _fake_hermes(monkeypatch, "anthropic", {"provider": "anthropic", "reasoning_effort": "high"})
    _call(model_choice={"provider": "anthropic", "model": "claude-haiku-5", "effort": "low"})
    assert captured["provider"] == "anthropic" and captured["model"] == "claude-haiku-5"
    assert captured["reasoning_config"] == {"enabled": True, "effort": "low"}
    assert captured["task"] == "prompt_studio"
    captured = _fake_hermes(monkeypatch, "anthropic", {"provider": "anthropic", "reasoning_effort": "high"})
    _call(model_choice={"provider": "anthropic", "model": "claude-haiku-5", "effort": ""})
    assert captured["reasoning_config"] == {"enabled": True, "effort": "high"}  # config effort
    captured = _fake_hermes(monkeypatch, "anthropic", {"reasoning_effort": "high"})
    _call(model_choice={"provider": "anthropic", "model": "claude-haiku-5", "effort": "none"})
    assert captured["reasoning_config"] == {"enabled": False, "effort": "none"}


def test_model_choice_for_another_provider_never_gets_the_config_endpoint_or_key(monkeypatch):
    config = {"provider": "", "base_url": "http://cfg.local/v1", "api_key": "sk-test-XXXX", "extra_body": {"top_k": 3}}
    captured = _fake_hermes(monkeypatch, None, config)
    _call(model_choice={"provider": "anthropic", "model": "claude-haiku-5", "effort": ""})
    # call_llm adopts auxiliary.<task>.base_url/api_key for an explicit provider unless the task is dropped.
    assert captured["task"] is None
    assert not captured.get("base_url") and not captured.get("api_key")
    assert captured["extra_body"] is None
    # Same provider as the config: the task (and its endpoint) stays.
    captured = _fake_hermes(monkeypatch, "custom", {**config, "provider": "custom"})
    _call(model_choice={"provider": "custom", "model": "m2", "effort": ""})
    assert captured["task"] == "prompt_studio" and captured["extra_body"] == {"top_k": 3}


def test_model_choice_drives_the_provider_adaptation_and_label(monkeypatch):
    captured = _fake_hermes(monkeypatch, "openai", {"provider": "openai"})
    _call(is_json=True, model_choice={"provider": "gemini", "model": "gemini-3-flash", "effort": ""})
    assert captured["extra_body"] == {"thinking_config": {"thinkingBudget": 0, "includeThoughts": False}}
    assert adapter.get_model_label({"provider": "gemini", "model": "gemini-3-flash"}) == "gemini/gemini-3-flash"
    assert adapter.get_model_label({"provider": "", "model": ""}) == "openai/m"


def test_invoke_hands_the_model_choice_to_the_default_adapter(monkeypatch):
    seen = {}
    monkeypatch.setattr(adapter, "_default_llm", lambda **kw: seen.update(kw) or ("t", "p/m"))
    adapter._invoke(None, [], max_tokens=1, timeout=1, model_choice={"provider": "p", "model": "m"})
    assert seen["model_choice"] == {"provider": "p", "model": "m"}


def test_no_config_block_and_no_model_choice_lets_hermes_auto_route(monkeypatch):
    # No auxiliary.prompt_studio block at all: Hermes resolves provider 'auto' (the user's main model).
    captured = _fake_hermes(monkeypatch, "auto", {})
    assert _call() == ("out", "routed/rm")
    assert captured["task"] == "prompt_studio"
    for key in ("provider", "model", "base_url", "api_key"):
        assert key not in captured
    # No effort anywhere: "low" is sent (lote 3 item 1). A provider that rejects the reasoning field is
    # retried by Hermes without it (auxiliary_client parameter rungs), so the call still works.
    assert captured["reasoning_config"] == {"enabled": True, "effort": "low"} and captured["extra_body"] is None


def test_default_llm_reports_the_finish_reason_and_still_unpacks_as_text_and_model(monkeypatch):
    # SP-3: the retry decision needs finish_reason; callers keep unpacking (text, model).
    fake = types.ModuleType("agent.auxiliary_client")
    fake.call_llm = lambda **kw: types.SimpleNamespace(choices=[types.SimpleNamespace(finish_reason="length")])
    fake.extract_content_or_reasoning = lambda r: ""
    fake._get_auxiliary_task_config = lambda task: {}
    fake._resolve_task_provider_model = lambda *a, **k: ("p", "m", None, None, None)
    fake._is_model_not_found_error = lambda exc: False  # checked before the call, like the extractor
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = lambda v: None
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)
    reply = adapter._invoke(None, [], max_tokens=10, timeout=1)
    text, model = reply
    assert (text, model) == ("", "p/m") and reply.finish_reason == "length"
    # A response without choices has no finish_reason, and nothing breaks.
    fake.call_llm = lambda **kw: {"choices": []}
    assert adapter._invoke(None, [], max_tokens=10, timeout=1).finish_reason == ""


# --- CT-03 characterization: pin _json_object behavior across its refactor.
def test_json_object_ct03_characterization():
    j = adapter._json_object
    assert j("[1, 2]") is None  # direct parse of a non-dict falls through, no braces
    assert j('[{"a": 1}]') == {"a": 1}  # non-dict top level, scan finds inner dict
    assert j('```JSON\n{"a": 1}\n```') == {"a": 1}  # fence is case-insensitive
    assert j('{"a": 1} {"value": 2}') == {"value": 2}  # preferred keys win over first
    assert j('{"a": 1} {"b": 2}') == {"a": 1}  # else first candidate
    assert j('{"a": {"prompt": 1}}') == {"a": {"prompt": 1}}  # direct parse wins
    assert j('x {"a": {"prompt": 1}}') == {"prompt": 1}  # nested candidate has the key
    assert j("{ not json") is None
    assert j("") is None
    assert j(123) is None


# The plugin sends no temperature: sampling stays as Hermes configures it for the model (Opus 5.5 rejects any
# non-default temperature, and Hermes already knows each model's rules).
def test_no_temperature_reaches_hermes(monkeypatch):
    captured = _fake_hermes(monkeypatch, "anthropic", {})
    adapter._invoke(None, [{"role": "user", "content": "x"}], max_tokens=10, timeout=1)
    assert "temperature" not in captured
    seen = {}
    adapter._invoke(lambda **kw: seen.update(kw) or "t", [], max_tokens=10, timeout=1)
    assert "temperature" not in seen


# Lote 3 item 1: with no effort anywhere, send "low" (Opus 5.5 docs: "Start at low effort and measure.")
# instead of letting the API fall back to its own default (medium on Opus 5.5).
def test_no_effort_configured_sends_low(monkeypatch):
    captured = _fake_hermes(monkeypatch, "anthropic", {})
    adapter._default_llm(messages=[], max_tokens=10, timeout=1)
    assert captured["reasoning_config"] == {"enabled": True, "effort": "low"}


def test_empty_choice_effort_without_config_effort_sends_low(monkeypatch):
    captured = _fake_hermes(monkeypatch, "anthropic", {})
    adapter._default_llm(messages=[], max_tokens=10, timeout=1,
                         model_choice={"provider": "anthropic", "model": "claude-opus-5-5", "effort": ""})
    assert captured["reasoning_config"] == {"enabled": True, "effort": "low"}


def test_configured_or_chosen_effort_still_wins_over_the_low_default(monkeypatch):
    captured = _fake_hermes(monkeypatch, "anthropic", {"reasoning_effort": "high"})
    adapter._default_llm(messages=[], max_tokens=10, timeout=1)
    assert captured["reasoning_config"] == {"enabled": True, "effort": "high"}
    captured = _fake_hermes(monkeypatch, "anthropic", {})
    adapter._default_llm(messages=[], max_tokens=10, timeout=1,
                         model_choice={"provider": "anthropic", "model": "m", "effort": "none"})
    assert captured["reasoning_config"] == {"enabled": False, "effort": "none"}


# Lote 3 item 2: max_tokens caps thinking plus text. Measured on OpenRouter (which forwards the cap) with
# claude-opus-5.5 and max_tokens 1024: effort max spent 1023 tokens on reasoning, finish_reason "length".
@pytest.mark.parametrize("effort,cap", [("medium", 4096), ("high", 8192), ("xhigh", 8192), ("max", 8192), ("ultra", 8192)])
def test_higher_effort_raises_a_small_token_cap(monkeypatch, effort, cap):
    captured = _fake_hermes(monkeypatch, "openrouter", {"reasoning_effort": effort})
    adapter._default_llm(messages=[], max_tokens=1024, timeout=1)
    assert captured["max_tokens"] == cap


@pytest.mark.parametrize("effort", ["", "none", "minimal", "low"])
def test_low_or_no_effort_keeps_the_callers_cap(monkeypatch, effort):
    captured = _fake_hermes(monkeypatch, "openrouter", {"reasoning_effort": effort} if effort else {})
    adapter._default_llm(messages=[], max_tokens=1024, timeout=1)
    assert captured["max_tokens"] == 1024


def test_a_larger_callers_cap_is_never_lowered(monkeypatch):
    captured = _fake_hermes(monkeypatch, "openrouter", {"reasoning_effort": "medium"})
    adapter._default_llm(messages=[], max_tokens=6000, timeout=1)
    assert captured["max_tokens"] == 6000



def test_is_provider_refused_covers_401_403_and_plan_messages():
    class E(Exception):
        pass

    def with_status(code):
        e = E("x"); e.status_code = code; return e

    class Resp:
        status_code = 403

    via_response = E("x"); via_response.response = Resp()
    assert adapter.is_provider_refused(with_status(403)) and adapter.is_provider_refused(with_status(401))
    assert adapter.is_provider_refused(via_response)
    assert adapter.is_provider_refused(E("Error code: MODEL_NOT_IN_PLAN"))
    assert adapter.is_provider_refused(E("model is Not In Plan"))
    assert adapter.is_provider_refused(type("PermissionDeniedError", (Exception,), {})("x"))
    assert adapter.is_provider_refused(type("AuthenticationError", (Exception,), {})("x"))
    assert not adapter.is_provider_refused(with_status(404))
    assert not adapter.is_provider_refused(with_status(500))
    assert not adapter.is_provider_refused(RuntimeError("down"))


def _status_exc(code, text="x", via_response=False):
    e = Exception(text)
    if via_response:
        e.response = type("Resp", (), {"status_code": code})()
    else:
        e.status_code = code
    return e


def test_is_provider_payment_covers_402_and_billing_messages():
    assert adapter.is_provider_payment(_status_exc(402))
    assert adapter.is_provider_payment(_status_exc(402, via_response=True))
    assert adapter.is_provider_payment(type("PaymentRequiredError", (Exception,), {})("x"))
    for text in ("Error code: 429 insufficient_quota", "Insufficient credits for this request",
                 "402 Payment Required", "billing_hard_limit_reached",
                 "Your credit balance is too low to access the API"):
        assert adapter.is_provider_payment(Exception(text)), text
    assert not adapter.is_provider_payment(_status_exc(403))
    assert not adapter.is_provider_payment(_status_exc(400))
    assert not adapter.is_provider_payment(RuntimeError("quota of tokens reached for context"))


# /review P2: the word "billing" alone is not a billing failure (rate limit, outage, a parameter name).
def test_billing_word_alone_is_not_a_payment_error():
    assert adapter.provider_error_code(_status_exc(429, "Rate limit reached. See billing documentation.")) == "unavailable"
    assert adapter.provider_error_code(_status_exc(500, "Billing service temporarily unavailable")) == "unavailable"
    assert adapter.provider_error_code(_status_exc(400, "Invalid parameter: billing_account")) == "provider_bad_request"
    assert adapter.provider_error_code(_status_exc(429, "insufficient_quota")) == "provider_payment"


def test_is_provider_bad_request_covers_400_and_badrequesterror():
    assert adapter.is_provider_bad_request(_status_exc(400))
    assert adapter.is_provider_bad_request(_status_exc(400, via_response=True))
    assert adapter.is_provider_bad_request(type("BadRequestError", (Exception,), {})("x"))
    assert not adapter.is_provider_bad_request(_status_exc(402))
    assert not adapter.is_provider_bad_request(_status_exc(500))
    assert not adapter.is_provider_bad_request(RuntimeError("bad things"))


def test_provider_error_code_precedence():
    assert adapter.provider_error_code(_status_exc(404)) == "model_not_found"
    assert adapter.provider_error_code(_status_exc(403, "insufficient_quota")) == "provider_refused"
    assert adapter.provider_error_code(_status_exc(400, "billing_hard_limit_reached")) == "provider_payment"
    assert adapter.provider_error_code(_status_exc(402)) == "provider_payment"
    assert adapter.provider_error_code(_status_exc(400)) == "provider_bad_request"
    assert adapter.provider_error_code(_status_exc(429)) == "unavailable"
    assert adapter.provider_error_code(_status_exc(500)) == "unavailable"
    assert adapter.provider_error_code(TimeoutError()) == "unavailable"


def _fake_refusing_json(monkeypatch, error, config=None, timeouts=None, refuse_after=0.0):
    calls = []
    configured = config or {}
    captured = _fake_hermes(monkeypatch, "claude-subscription-directsdk-experimental", configured)
    fake = sys.modules["agent.auxiliary_client"]

    def call_llm(**kw):
        calls.append(kw.get("extra_body"))
        if timeouts is not None:
            timeouts.append(kw["timeout"])
        # Like Hermes' _prepare_aux_request: the task's configured extra_body, then the call's overrides.
        effective = dict(configured.get("extra_body") or {}) if kw.get("task") else {}
        effective.update(kw.get("extra_body") or {})
        if effective.get("response_format", {}).get("type") not in (None, "text"):
            if refuse_after:
                adapter.time.sleep(refuse_after)
            raise error
        kw["route_info"].update({"provider": "routed", "model": "rm"})
        return {"choices": []}

    fake.call_llm = call_llm
    return calls


def test_route_that_refuses_json_mode_is_retried_without_response_format(monkeypatch):
    calls = _fake_refusing_json(monkeypatch, ValueError("Only json_schema structured output is supported"))
    assert _call(is_json=True) == ("out", "routed/rm")
    assert calls == [{"response_format": {"type": "json_object"}}, None]


def test_400_naming_response_format_is_retried_without_it(monkeypatch):
    err = type("BadRequestError", (Exception,), {})("response_format json_object is not supported by this model")
    calls = _fake_refusing_json(monkeypatch, err)
    assert _call(is_json=True) == ("out", "routed/rm")
    assert len(calls) == 2 and calls[1] is None


def test_other_failures_are_not_retried(monkeypatch):
    calls = _fake_refusing_json(monkeypatch, ValueError("model not found"))
    with pytest.raises(ValueError):
        _call(is_json=True)
    assert len(calls) == 1


def test_configured_json_format_is_overridden_on_retry_not_just_dropped(monkeypatch):
    config = {"extra_body": {"response_format": {"type": "json_object"}, "top_k": 3}}
    calls = _fake_refusing_json(monkeypatch, ValueError("Only json_schema structured output is supported"), config)
    assert _call(is_json=True) == ("out", "routed/rm")
    assert calls[1] == {"top_k": 3, "response_format": {"type": "text"}}


def test_retry_gets_only_the_rest_of_the_budget(monkeypatch):
    timeouts = []
    _fake_refusing_json(monkeypatch, ValueError("Only json_schema structured output is supported"),
                        timeouts=timeouts, refuse_after=0.3)
    adapter._default_llm(messages=[], max_tokens=10, timeout=5, is_json=True)
    assert timeouts[0] == 5 and timeouts[1] <= 5 - 0.3


def test_no_retry_once_the_budget_is_spent(monkeypatch):
    timeouts = []
    calls = _fake_refusing_json(monkeypatch, ValueError("Only json_schema structured output is supported"),
                                timeouts=timeouts, refuse_after=0.3)
    monkeypatch.setattr(adapter, "RETRY_MIN_SECONDS", 1.0)
    with pytest.raises(ValueError):
        adapter._default_llm(messages=[], max_tokens=10, timeout=1.2, is_json=True)
    assert len(calls) == 1


# Issue #26: only the answer (message.content) becomes a suggestion; JSON inside the thinking never does.
def _fake_with_host_fallback(monkeypatch, response):
    """Fake Hermes whose extract_content_or_reasoning falls back to reasoning like the real one."""
    fake = types.ModuleType("agent.auxiliary_client")

    def extract(resp):
        msg = resp["choices"][0]["message"] if isinstance(resp, dict) and "choices" in resp else resp
        content = (msg.get("content") or "").strip()
        return content or (msg.get("reasoning") or msg.get("reasoning_content") or "").strip()

    fake.call_llm = lambda **kw: response
    fake.extract_content_or_reasoning = extract
    fake._get_auxiliary_task_config = lambda task: {}
    fake._resolve_task_provider_model = lambda *a, **k: ("p", "m", None, None, None)
    fake._is_model_not_found_error = lambda exc: False  # checked before the call, like the extractor
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", fake)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    hc = types.ModuleType("hermes_constants")
    hc.parse_reasoning_effort = lambda v: None
    monkeypatch.setitem(sys.modules, "hermes_constants", hc)


def test_empty_content_with_json_in_the_reasoning_is_an_empty_reply(monkeypatch):
    reasoning = '{"value": "Sim", "reason": "pensando"}'
    for field in ("reasoning", "reasoning_content"):
        response = {"choices": [{"finish_reason": "length", "message": {"content": "", field: reasoning}}]}
        _fake_with_host_fallback(monkeypatch, response)
        reply = adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)
        assert reply[0] == "" and reply.finish_reason == "length"
    # Same through an attribute-style response, with content None.
    msg = types.SimpleNamespace(content=None, reasoning=reasoning)
    _fake_with_host_fallback(monkeypatch, types.SimpleNamespace(choices=[types.SimpleNamespace(finish_reason="stop", message=msg)]))
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == ""


def test_the_answer_content_is_still_returned_when_there_is_reasoning_too(monkeypatch):
    response = {"choices": [{"finish_reason": "stop", "message": {"content": '{"value": "Não"}', "reasoning": '{"value": "Sim"}'}}]}
    _fake_with_host_fallback(monkeypatch, response)
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == '{"value": "Não"}'


def _content_response(content, finish_reason="stop"):
    return {"choices": [{"finish_reason": finish_reason, "message": {"content": content}}]}


def test_unclosed_think_block_is_never_the_answer(monkeypatch):
    for tag in ("think", "thinking", "reasoning"):
        content = f'<{tag}>working out {{"value":"Yes","reason":"internal candidate"}}'
        _fake_with_host_fallback(monkeypatch, _content_response(content, "length"))
        reply = adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)
        assert reply[0] == "" and reply.finish_reason == "length"


def test_json_before_an_unclosed_think_block_is_still_the_answer(monkeypatch):
    answer = '{"value": "No", "reason": "ok"}'
    _fake_with_host_fallback(monkeypatch, _content_response(answer + '\n<think>and also {"value":"Yes"}', "length"))
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == answer


def test_a_literal_thinking_tag_inside_the_answer_json_is_preserved(monkeypatch):
    # Codex P2: an unpaired tag mentioned inside a JSON string is answer data, not an unclosed thinking block.
    for tag in ("think", "thinking", "reasoning"):
        answer = json.dumps({"prompt": f"Explain the literal <{tag}> tag.", "notes": ""})
        _fake_with_host_fallback(monkeypatch, _content_response(answer))
        assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == answer
    # A closed block around the mention is still stripped; the answer survives.
    answer = '{"value": "No"}'
    _fake_with_host_fallback(monkeypatch, _content_response(f'<think>mention of <think> here</think>\n{answer}'))
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0].strip() == answer


def test_list_content_keeps_only_the_text_parts(monkeypatch):
    answer = '{"value": "No", "reason": "ok"}'
    parts = [
        {"type": "thinking", "thinking": '{"value": "Yes"}'},
        {"type": "reasoning", "text": '{"value": "Maybe"}'},
        {"type": "text", "text": answer},
    ]
    _fake_with_host_fallback(monkeypatch, _content_response(parts))
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == answer
    # Only thinking parts: nothing to answer with.
    _fake_with_host_fallback(monkeypatch, _content_response(parts[:2], "length"))
    assert adapter._invoke(None, [], max_tokens=10, timeout=1, is_json=True)[0] == ""
