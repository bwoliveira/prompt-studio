"""REG-FORMATS: real engines/adapter/parser, fake Hermes SDK and memory-only store.

The JSON reader deliberately accepts prose, fences and objects inside other
output. These tests preserve that tolerance; they test consumer field types,
language boundaries and answer data versus reasoning, not a new wire format.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODEL = "regression/formats"
DRAFT_PT = 'Revise o relatório de São Luís; preserve "ação", 3,5% e R$ 20.'
DRAFT_EN = 'Review the report from São Luís; preserve "ação", 3.5% and R$ 20.'
TEXT_FIELD = {"id": "context", "kind": "text", "question": "Context?"}
ROUTES = ("suggest", "improve", "compose", "context")
HOST_REASONING_TAGS = ("think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD", "思考", "反思", "推理", "推敲")


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"regression_formats_{name}", ROOT / "dashboard" / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def engines():
    modules = types.SimpleNamespace(se=_load("suggest_engine"), sc=_load("session_context"))
    yield modules
    for pool in (modules.se._EXECUTOR, modules.se._COMPOSE_EXECUTOR, modules.sc._EXECUTOR):
        pool.shutdown(wait=True, cancel_futures=True)


@pytest.fixture
def transport(monkeypatch):
    """Replace only the external Hermes SDK; keep the production adapter intact."""
    auxiliary = types.ModuleType("agent.auxiliary_client")
    auxiliary._get_auxiliary_task_config = lambda task: {}
    auxiliary._resolve_task_provider_model = lambda task: ("regression", "formats", None, None, None)
    auxiliary._is_model_not_found_error = lambda exc: False

    def extract(response):
        # The host strips paired tags even inside JSON strings before trying reasoning.
        # An identity extractor hid a second destructive cleaning pass in the real adapter.
        if isinstance(response, str):
            return response.strip()
        message = response["choices"][0]["message"] if "choices" in response else response
        raw = message.get("content")
        content = raw.strip() if isinstance(raw, str) else str(raw).strip() if raw else ""
        for tag in HOST_REASONING_TAGS:
            content = re.sub(rf"<{tag}>.*?</{tag}>", "", content, flags=re.DOTALL | re.IGNORECASE)
        return content.strip() or message.get("reasoning") or message.get("reasoning_content") or ""

    auxiliary.extract_content_or_reasoning = extract
    constants = types.ModuleType("hermes_constants")
    constants.parse_reasoning_effort = lambda effort: {"enabled": True, "effort": effort}
    redactor = types.ModuleType("agent.redact")
    redactor.redact_sensitive_text = lambda text, force=False: text
    for name, module in (
        ("agent", types.ModuleType("agent")),
        ("agent.auxiliary_client", auxiliary),
        ("agent.redact", redactor),
        ("hermes_constants", constants),
    ):
        monkeypatch.setitem(sys.modules, name, module)

    def install(content, *, finish_reason="stop", reasoning=""):
        calls = []

        def call_llm(**kwargs):
            calls.append(kwargs)
            kwargs["route_info"].update(provider="regression", model="formats")
            return {"choices": [{
                "finish_reason": finish_reason,
                "message": {"content": content, "reasoning": reasoning},
            }]}

        auxiliary.call_llm = call_llm
        return calls

    return install


class _MemoryStore:
    def __init__(self, text):
        self.text = text
        self.closed = False

    def resolve_session_id(self, session_id):
        assert session_id == "formats-session"
        return session_id

    def get_messages(self, session_id, *, limit, latest):
        assert session_id == "formats-session" and latest is True and limit > 0
        return [{"role": "user", "content": self.text, "active": 1}]

    def close(self):
        self.closed = True


def _run(engines, route, *, locale="en", draft=DRAFT_PT, field=None):
    payload = {"target": "opus", "intent": draft, "locale": locale}
    if route in ("suggest", "improve"):
        return engines.se.suggest({
            **payload, "field": field or TEXT_FIELD, "mode": route,
            "answer": draft if route == "improve" else "",
        })
    if route == "compose":
        return engines.se.compose({**payload, "answers": [], "baseline": f"TASK\n{draft}"})
    assert route == "context"
    store = _MemoryStore(draft)
    try:
        return engines.sc.context(
            {"session_id": "formats-session", "locale": locale}, opener=lambda profile: store
        )
    finally:
        assert store.closed, "the fake store must be closed on success and on invalid model output"


def _field_name(route):
    return {"suggest": "value", "improve": "value", "compose": "prompt", "context": "summary"}[route]


def _encoded(route, text, sentence="Only wording changed."):
    data = {_field_name(route): text}
    if route in ("suggest", "improve"):
        data["reason"] = sentence
    elif route == "compose":
        data["notes"] = sentence
    return json.dumps(data, ensure_ascii=False)


def _assert_failure(out, code):
    assert out.get("ok") is False, out
    assert out.get("code") == code, out
    assert out["model"] == MODEL
    assert not {"value", "prompt", "summary", "agrees"}.intersection(out), out


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("locale,draft,language,sentence", [
    pytest.param("en", DRAFT_PT, "English", "Only wording changed.", id="en-ui-pt-draft"),
    pytest.param("pt", DRAFT_EN, "Brazilian Portuguese", "Apenas a redação mudou.", id="pt-ui-en-draft"),
    pytest.param("unknown-locale", DRAFT_PT, "English", "Only wording changed.", id="unknown-ui-pt-draft"),
])
def test_reg_formats_locale_does_not_translate_the_draft(engines, transport, route, locale, draft, language, sentence):
    # Contracts: human-facing text follows locale; draft/value/prompt do not.
    returned = sentence if route == "context" else draft
    calls = transport(_encoded(route, returned, sentence))
    out = _run(engines, route, locale=locale, draft=draft)
    assert out["ok"] is True, out
    assert out[_field_name(route)] == returned
    assert out["model"] == MODEL and len(calls) == 1
    system, user = (message["content"] for message in calls[0]["messages"])
    assert f"in {language}" in system
    assert draft in user
    if route == "improve":
        assert f"<answer>\n{draft}\n</answer>" in user
        assert "Keep the user's language" in system
    elif route != "context":
        assert "language of the user's draft" in system
    if route in ("suggest", "improve", "compose"):
        assert out["notes" if route == "compose" else "reason"] == sentence


@pytest.mark.parametrize("route", ["suggest", "compose", "context"])
@pytest.mark.parametrize("wrapper", ["fence-after-think", "prose-with-braces", "array-container"])
def test_reg_formats_wrapped_json_reaches_the_real_consumers(engines, transport, route, wrapper):
    # Braces, quotes, Unicode and a newline inside a string are answer data.
    wanted = 'Preserve {customer}, "ação" e São Luís.\nDo not change R$ 20.'
    answer = _encoded(route, wanted)
    if wrapper == "fence-after-think":
        decoy = _encoded(route, "INTERNAL-CANDIDATE: never deliver this text.")
        content = f"<THINKING>{decoy}</THINKING>\n```JSON\n{answer}\n```"
    elif wrapper == "prose-with-braces":
        content = f"Model reply {{not valid JSON}}:\n{answer}\nEnd."
    else:
        # _json_object intentionally scans into array containers; do not tighten it.
        content = f"[{answer}]"
    calls = transport(content)
    out = _run(engines, route)
    assert out["ok"] is True, out
    assert out[_field_name(route)] == wanted
    assert "INTERNAL-CANDIDATE" not in json.dumps(out)
    assert len(calls) == 1


NON_STRINGS = [
    pytest.param(None, id="null"),
    pytest.param(False, id="false"),
    pytest.param(True, id="true"),
    pytest.param(7, id="number"),
    pytest.param(["Never stringify this list into a suggestion."], id="list"),
    pytest.param({"text": "Never stringify this object into a suggestion."}, id="object"),
]


@pytest.mark.parametrize("bad_value", NON_STRINGS)
@pytest.mark.parametrize("route,field", [
    pytest.param("suggest", TEXT_FIELD, id="suggest-text"),
    pytest.param("improve", TEXT_FIELD, id="improve-text"),
    pytest.param("suggest", {**TEXT_FIELD, "kind": "design", "hint": "Keep the existing visual style."}, id="suggest-design"),
])
def test_reg_formats_nonstring_value_is_not_a_successful_empty_answer(engines, transport, route, field, bad_value):
    # The response contract says value is text. Empty TEXT is valid; malformed
    # model data is not the model explicitly saying there is nothing to add.
    calls = transport(json.dumps({"value": bad_value, "reason": "Unusable field type."}))
    out = _run(engines, route, field=field)
    assert len(calls) == 1
    _assert_failure(out, "invalid_suggestion")
    assert out["error"] == "model reply is not a valid suggestion"


@pytest.mark.parametrize("bad_value", NON_STRINGS)
@pytest.mark.parametrize("route,code", [("compose", "invalid_prompt"), ("context", "invalid_summary")])
def test_reg_formats_nonstring_prompt_and_summary_fail_without_fabrication(engines, transport, route, code, bad_value):
    calls = transport(json.dumps({_field_name(route): bad_value}))
    out = _run(engines, route)
    assert len(calls) == 1
    _assert_failure(out, code)
    assert "Never stringify" not in json.dumps(out)


@pytest.mark.parametrize("bad_value", NON_STRINGS)
@pytest.mark.parametrize("route,metadata", [("suggest", "reason"), ("compose", "notes")])
def test_reg_formats_invalid_optional_sentence_is_empty_not_stringified(engines, transport, route, metadata, bad_value):
    # Optional explanatory text is cleaned, not rendered as Python/JSON repr.
    wanted = "Preserve the report, its currency amounts and accented names."
    calls = transport(json.dumps({_field_name(route): wanted, metadata: bad_value}))
    out = _run(engines, route)
    assert out["ok"] is True, out
    assert out[_field_name(route)] == wanted
    assert out[metadata] == ""
    assert len(calls) == 1


@pytest.mark.parametrize("value,expected", [
    pytest.param("N", None, id="ambiguous-prefix"),
    pytest.param("Não executar agora", None, id="invented-extension"),
    pytest.param("Yes", None, id="translated-but-not-listed"),
    pytest.param(None, None, id="null"),
    pytest.param(False, None, id="boolean"),
    pytest.param(["Sim"], None, id="list"),
    pytest.param("  NÃO  ", "Não", id="exact-before-ambiguous-prefix"),
    pytest.param("S", "Sim", id="unique-prefix-stays-supported"),
])
def test_reg_formats_choice_ambiguity_never_guesses_the_recommended_option(engines, transport, value, expected):
    field = {
        "id": "autonomy", "kind": "enum", "question": "Executar?",
        "options": ["Não", "Não executar", "Sim"], "recommended": "Sim",
    }
    calls = transport(json.dumps({"value": value, "reason": "Choose carefully."}))
    out = _run(engines, "suggest", locale="en", field=field)
    assert len(calls) == 1
    if expected is None:
        _assert_failure(out, "unknown_option")
        assert out["error"] == "model suggested an option that is not listed"
    else:
        assert out["ok"] is True and out["value"] == expected, out
        assert out["agrees"] is (expected == field["recommended"])


@pytest.mark.parametrize("route,code", [
    ("suggest", "invalid_suggestion"), ("compose", "invalid_prompt"), ("context", "invalid_summary"),
])
@pytest.mark.parametrize("shape", ["malformed-fence", "wrong-key", "scalar-list"])
def test_reg_formats_invalid_json_has_fixed_errors_and_no_echo_or_default(engines, transport, route, code, shape):
    private = "MODEL-BODY-NOT-FOR-THE-USER"
    if shape == "malformed-fence":
        content = f'```json\n{{"{_field_name(route)}": "{private}"\n```'
    elif shape == "wrong-key":
        content = json.dumps({"unexpected": private})
    else:
        content = json.dumps([private, False, None])
    calls = transport(content)
    out = _run(engines, route)
    assert len(calls) == 1
    _assert_failure(out, code)
    assert out["error"] == {
        "suggest": "model reply is not a valid suggestion",
        "compose": "model reply is not a valid prompt",
        "context": "model reply is not a valid summary",
    }[route]
    assert private not in json.dumps(out)
    assert DRAFT_PT not in json.dumps(out, ensure_ascii=False)


@pytest.mark.parametrize("route", ["suggest", "compose", "context"])
def test_reg_formats_thinking_only_never_becomes_a_model_answer(engines, transport, route):
    decoy = _encoded(route, "INTERNAL-CANDIDATE: there was no final answer.")
    calls = transport(f"<think>{decoy}", finish_reason="length", reasoning=decoy)
    out = _run(engines, route)
    _assert_failure(out, "invalid_summary" if route == "context" else "empty_reply")
    assert "INTERNAL-CANDIDATE" not in json.dumps(out)
    assert len(calls) == 1, "a length-exhausted reply must not repeat the same paid request"


@pytest.mark.parametrize("route", ["suggest", "compose", "context"])
@pytest.mark.parametrize("tag", ["think", "thinking", "reasoning"])
@pytest.mark.parametrize("wrapper", ["plain", "fenced", "prose"])
def test_reg_formats_closed_thinking_tags_inside_json_strings_are_answer_data(engines, transport, route, tag, wrapper):
    # The existing adapter test protects an unpaired literal tag. A paired XML
    # example in a valid JSON string is equally user-owned text, not reasoning.
    wanted = f'Keep the XML example <{tag}>ação = "São Luís"</{tag}> unchanged.'
    content = _encoded(route, wanted)
    if wrapper == "fenced":
        content = f"```json\n{content}\n```"
    elif wrapper == "prose":
        content = f"Reply {{not JSON}}:\n{content}\nEnd."
    calls = transport(content)
    out = _run(engines, route, draft=wanted)
    assert out["ok"] is True, out
    assert out[_field_name(route)] == wanted, out
    assert len(calls) == 1


@pytest.mark.parametrize("tag", ["think", "THINKING", "reasoning"])
@pytest.mark.parametrize("wrapper", ["plain", "fenced", "prose"])
def test_reg_formats_both_parser_stages_preserve_json_and_remove_external_reasoning(engines, tag, wrapper):
    adapter = engines.se._llm
    wanted = f'Keep "<{tag}>ação {{example}} \\ path</{tag}>" unchanged.'
    data = {"value": wanted}
    encoded = json.dumps(data, ensure_ascii=False)
    answer = {
        "plain": encoded,
        "fenced": f"```json\n{encoded}\n```",
        "prose": f"Reply {{not JSON}}:\n{encoded}\nEnd.",
    }[wrapper]
    # Quotes and braces in reasoning must not masquerade as JSON boundaries.
    decoy = '<' + tag + '>unmatched " { ' + json.dumps({"value": "INTERNAL"}) + '</' + tag + '>'
    content = decoy + "\n" + answer + "\n" + decoy
    assert adapter._answer_text(content).strip() == answer
    assert adapter._json_object(content) == data
    assert adapter._json_object(adapter._answer_text(content)) == data


@pytest.mark.parametrize("tag", ["think", "thinking", "reasoning"])
@pytest.mark.parametrize("closed", [False, True])
def test_reg_formats_neither_parser_stage_extracts_json_from_external_reasoning(engines, tag, closed):
    adapter = engines.se._llm
    content = f'<{tag}>{{"value": "INTERNAL", "prompt": "Never deliver this candidate."}}'
    if closed:
        content += f"</{tag}>"
    assert adapter._answer_text(content).strip() == ""
    assert adapter._json_object(content) is None


@pytest.mark.parametrize("tag", HOST_REASONING_TAGS[3:])
def test_reg_formats_bypassing_host_cleanup_keeps_all_host_reasoning_tags_outside_the_answer(engines, transport, tag):
    # Skipping the host's destructive second pass must not drop its other reasoning markers.
    wanted = f'Keep <{tag}>a literal example</{tag}> inside the answer.'
    decoy = _encoded("suggest", "INTERNAL-CANDIDATE: never expose this reasoning.")
    content = f"<{tag}>{decoy}</{tag}>\n" + _encoded("suggest", wanted)
    calls = transport(content, reasoning=decoy)
    out = _run(engines, "suggest", draft=wanted)
    assert out["ok"] is True, out
    assert out["value"] == wanted
    assert "INTERNAL-CANDIDATE" not in json.dumps(out)
    assert len(calls) == 1
