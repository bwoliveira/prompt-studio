"""#40: docs/CONTRACT.md and the code agree, field by field: request fields, literal types, limits, error codes, route errors."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Literal, get_args

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))
import hermes_host  # noqa: E402
import llm_adapter  # noqa: E402
import plugin_api  # noqa: E402

DOC = (ROOT / "docs" / "CONTRACT.md").read_text(encoding="utf-8")
UI_BUNDLE = (ROOT / "desktop" / "src" / "i18n-ui.js").read_text(encoding="utf-8")


def _block(route: str) -> dict:
    match = re.search(rf"## POST /{route}\n```json\n(.*?)\n```", DOC, re.S)
    assert match, f"no JSON block for /{route} in CONTRACT.md"
    return json.loads(match.group(1))


def _fields(model) -> set[str]:
    return set(model.model_fields)


def _marked_required(block: dict) -> set[str]:
    return {name for name, value in block.items() if isinstance(value, str) and re.search(r"\(required[,)]", value)}


def _required_scalars(model) -> set[str]:
    return {name for name, info in model.model_fields.items() if info.is_required() and info.annotation is str}


# --- request fields -------------------------------------------------------------------------------------------

def test_suggest_block_lists_exactly_the_request_fields():
    block = _block("suggest")
    assert set(block) == _fields(plugin_api.SuggestRequest)
    assert set(block["ladder"][0]) == _fields(plugin_api.LadderRung)
    assert set(block["field"]) == _fields(plugin_api.SuggestField)
    assert set(block["model_choice"]) == _fields(plugin_api.ModelChoice)
    assert _marked_required(block) == _required_scalars(plugin_api.SuggestRequest)
    assert _marked_required(block["field"]) == _required_scalars(plugin_api.SuggestField)


def test_compose_block_lists_exactly_the_request_fields():
    block = _block("compose")
    assert set(block) == _fields(plugin_api.ComposeRequest)
    assert set(block["answers"][0]) == _fields(plugin_api.ComposeAnswer)
    assert set(block["model_choice"]) == _fields(plugin_api.ModelChoice)
    assert _marked_required(block) == _required_scalars(plugin_api.ComposeRequest)


def test_context_block_lists_exactly_the_request_fields():
    block = _block("context")
    assert set(block) == _fields(plugin_api.ContextRequest)
    assert set(block["model_choice"]) == _fields(plugin_api.ModelChoice)
    assert _marked_required(block) == _required_scalars(plugin_api.ContextRequest)


# --- literal field types --------------------------------------------------------------------------------------

def test_only_effort_is_a_literal_and_the_doc_says_so():
    literal_fields = []
    for model in (plugin_api.ModelChoice, plugin_api.SuggestRequest, plugin_api.SuggestField, plugin_api.ComposeRequest,
                  plugin_api.ComposeAnswer, plugin_api.ContextRequest, plugin_api.LadderRung):
        for name, info in model.model_fields.items():
            if getattr(info.annotation, "__origin__", None) is Literal:
                literal_fields.append(f"{model.__name__}.{name}")
    assert literal_fields == ["ModelChoice.effort"]
    # The efforts the doc lists are the efforts the model accepts ("" and none are written out in prose).
    accepted = set(get_args(plugin_api.ModelChoice.model_fields["effort"].annotation))
    listed = set(re.search(r"`(minimal\|low\|[a-z|]+)` sets it", DOC).group(1).split("|")) | {"", "none"}
    assert listed == accepted
    assert re.search(r"`model_choice\.effort` is the only literal type", DOC)
    for plain in ("`target`", "`mode`", "`locale`", "`field.kind`", "`answers[].kind`"):
        assert plain in DOC.split("`model_choice` (/suggest")[0], f"{plain} not named as a plain string"


@pytest.mark.parametrize("path, body", [
    ("/suggest", {"target": "gpt-9", "mode": "rewrite", "locale": "fr", "intent": "x", "field": {"question": "q", "kind": "other"}}),
    ("/compose", {"target": "gpt-9", "locale": "fr", "intent": "x", "answers": [{"id": "a", "kind": "other", "answer": "b"}]}),
])
def test_plain_string_fields_never_refuse_an_unlisted_value(monkeypatch, path, body):
    api = _client(monkeypatch)
    assert api.post(path, json=body).status_code == 200


def test_effort_outside_the_list_is_a_422(monkeypatch):
    api = _client(monkeypatch)
    response = api.post("/suggest", json={"intent": "x", "field": {"question": "q"}, "model_choice": {"effort": "extreme"}})
    assert response.status_code == 422


def test_documented_limits_are_the_code_limits():
    for value in (plugin_api.BIG_TEXT, plugin_api.MID_TEXT, plugin_api.SESSION_CONTEXT_TEXT):
        assert f"{value:,}".replace(",", " ") in DOC or str(value) in DOC, value
    assert re.search(rf"\bids/kinds/target/mode/locale {plugin_api.SHORT_TEXT}\b", DOC)
    assert re.search(rf"at most {plugin_api.MAX_ITEMS} items", DOC)
    choice = plugin_api.ModelChoice.model_fields
    limits = {name: next(m.max_length for m in info.metadata if hasattr(m, "max_length")) for name, info in choice.items()}
    assert f"provider ≤ {limits['provider']} chars, model ≤ {limits['model']}, effort ≤ {limits['effort']}" in DOC


# --- route errors ---------------------------------------------------------------------------------------------

class _Engine:
    def suggest(self, payload):
        return {"ok": True, "value": "v", "reason": "r", "model": "m", "latency_ms": 1, "source": "model"}

    def compose(self, payload):
        return {"ok": True, "prompt": "p" * 30, "notes": "n", "model": "m", "latency_ms": 1, "source": "model"}


def _client(monkeypatch, engine=None):
    monkeypatch.setattr(plugin_api, "_load", lambda name, attr: engine or _Engine())
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app)


class _Broken:
    def __getattr__(self, name):
        raise RuntimeError("boom")


def test_route_errors_have_the_documented_status_and_shape(monkeypatch):
    api = _client(monkeypatch)
    blank = api.post("/suggest", json={"intent": "  ", "field": {"question": "q"}})
    assert blank.status_code == 400 and blank.json() == {"ok": False, "error": "intent and field.question are required"}
    blank = api.post("/suggest", json={"intent": "x", "field": {"question": " "}})
    assert blank.status_code == 400 and "code" not in blank.json()
    blank = api.post("/compose", json={"intent": ""})
    assert blank.status_code == 400 and blank.json() == {"ok": False, "error": "intent is required"}
    too_big = api.post("/suggest", json={"intent": "x", "field": {"question": "q"}, "session_context": "y" * 3001})
    bad_id = api.post("/context", json={"session_id": "no spaces allowed"})
    bad_profile = api.post("/context", json={"session_id": "ok", "profile": "no/slash"})
    for response in (too_big, bad_id, bad_profile):
        assert response.status_code == 422 and "ok" not in response.json() and isinstance(response.json()["detail"], list)
    broken = _client(monkeypatch, _Broken())
    assert broken.post("/suggest", json={"intent": "x", "field": {"question": "q"}}).json() == {"ok": False, "error": "suggest engine unavailable"}
    assert broken.post("/suggest", json={"intent": "x", "field": {"question": "q"}}).status_code == 500
    assert broken.post("/compose", json={"intent": "x"}).json() == {"ok": False, "error": "compose engine unavailable"}
    assert broken.post("/context", json={"session_id": "ok"}).status_code == 200
    assert broken.post("/context", json={"session_id": "ok"}).json() == {"ok": False, "code": "unavailable", "error": "context reader unavailable"}


def test_the_status_table_of_the_contract_names_what_the_routes_answer():
    table = DOC.split("| Status | Route | Body |")[1].split("\n\n")[0]
    rows = [line.split("|")[1:4] for line in table.strip().splitlines()[1:]]
    assert [(status.strip(), route.strip()) for status, route, _ in rows] == [
        ("400", "/suggest"), ("400", "/compose"), ("422", "all three"), ("500", "/suggest, /compose"), ("200", "/context")]
    for text in ("intent and field.question are required", "intent is required", "suggest engine unavailable",
                 "compose engine unavailable", "context reader unavailable"):
        assert text in table


# --- error codes ----------------------------------------------------------------------------------------------

def _doc_codes(header: str) -> dict[str, str]:
    """code -> table row, for the table that starts with ``header``."""
    table = DOC.split(header)[1].split("\n\n")[0]
    return {m.group(1): line for line in table.splitlines() if (m := re.match(r"\| `(\w+)` \|", line))}


def _source(name: str) -> str:
    return (ROOT / "dashboard" / f"{name}.py").read_text(encoding="utf-8")


PROVIDER_CODES = {row[0] for row in llm_adapter.PROVIDER_ERRORS}


def test_context_codes_in_the_doc_are_the_codes_session_context_returns():
    doc = set(_doc_codes("| `code` | When | `error` |"))
    code = set(re.findall(r'_error\("(\w+)"', _source("session_context"))) | PROVIDER_CODES | {hermes_host.CODE}
    assert doc == code


def test_engine_codes_in_the_doc_are_the_codes_suggest_and_compose_return():
    doc = set(_doc_codes("| `code` | Route | When | `error` |"))
    code = set(re.findall(r'"code": "(\w+)"', _source("suggest_engine"))) | PROVIDER_CODES | {hermes_host.CODE, "unavailable"}
    assert doc == code


def test_bad_request_is_documented_as_unreachable_over_rest_and_is():
    for header in ("| `code` | When | `error` |", "| `code` | Route | When | `error` |"):
        assert "Not reachable over REST" in _doc_codes(header)["bad_request"]
    # The routes validate first, so the engines' own bad_request never reaches a client (the engines keep it for direct callers).
    sys.path.insert(0, str(ROOT / "dashboard"))
    import session_context
    import suggest_engine
    assert suggest_engine.suggest({"intent": "", "field": {"question": "q"}})["code"] == "bad_request"
    assert suggest_engine.compose({"intent": ""})["code"] == "bad_request"
    assert session_context.context({"session_id": "has space"})["code"] == "bad_request"


def _ui_error_codes(locale: str) -> set[str]:
    bundle = UI_BUNDLE.split(f"\n  {locale}: {{")[1].split("\n  },\n")[0]
    block = bundle.split("\n    errors: {\n")[1].split("\n    },\n")[0]
    return set(re.findall(r"^      (\w+):", block, re.M))


@pytest.mark.parametrize("locale", ["en", "pt"])
def test_every_code_a_client_can_receive_has_a_ui_text_and_nothing_else_does(locale):
    reachable = {code for header in ("| `code` | When | `error` |", "| `code` | Route | When | `error` |")
                 for code, row in _doc_codes(header).items() if "Not reachable over REST" not in row}
    assert _ui_error_codes(locale) == reachable
