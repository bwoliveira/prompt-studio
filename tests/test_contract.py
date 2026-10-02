"""#40: docs/CONTRACT.md and the code agree, field by field: request fields, literal types, limits, error codes, route errors."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Literal, get_args

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))
import plugin_api  # noqa: E402
sys.path.insert(0, str(ROOT / "tests"))
from test_hermes_host import _fake_hermes, _override  # noqa: E402

DOC = (ROOT / "docs" / "CONTRACT.md").read_text(encoding="utf-8")


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
# The code tables of CONTRACT.md are checked against what the real routes answer (the real engines and adapter over a
# fake Hermes), one scenario per code; the UI texts for these codes are checked in tests/desktop/studio-core.test.mjs.

def _doc_rows(header: str) -> dict[str, str]:
    """code -> table row, for the table that starts with ``header``."""
    table = DOC.split(header)[1].split("\n\n")[0]
    return {m.group(1): line for line in table.splitlines() if (m := re.match(r"\| `(\w+)` \|", line))}


CONTEXT_HEADER = "| `code` | When | `error` |"
ENGINE_HEADER = "| `code` | Route | When | `error` |"
UNREACHABLE = "Not reachable over REST"


def _doc_engine_pairs() -> set[tuple[str, str]]:
    pairs = set()
    for code, row in _doc_rows(ENGINE_HEADER).items():
        route = row.split("|")[2].strip()
        if UNREACHABLE in row:
            continue
        pairs |= {(r, code) for r in (("/suggest", "/compose") if route == "both" else (route,))}
    return pairs


def _doc_context_codes() -> set[str]:
    return {code for code, row in _doc_rows(CONTEXT_HEADER).items() if UNREACHABLE not in row}


class _Provider(Exception):
    def __init__(self, status: int):
        super().__init__("provider said no")
        self.status_code = status


def _world(monkeypatch, *, reply: str = "{}", raises: Exception | None = None, delay: float = 0.0, **overrides):
    """A fake Hermes whose model answers ``reply``, raises ``raises`` or answers after ``delay`` seconds."""
    def call_llm(*, task=None, provider=None, model=None, messages, max_tokens=None, timeout=None, extra_body=None,
                 reasoning_config=None, route_info=None):
        time.sleep(delay)
        if raises is not None:
            raise raises
        return {"choices": []}

    _fake_hermes(monkeypatch, **{
        "agent.auxiliary_client.call_llm": call_llm,
        "agent.auxiliary_client.extract_content_or_reasoning": lambda response, *, max_reasoning_chars=None: reply,
        **overrides,
    })


def _real_client() -> TestClient:
    """The real routes, engines and adapter (no stub engine): only Hermes is fake."""
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app)


ENUM_FIELD = {"id": "a", "kind": "enum", "question": "Q?", "options": ["Yes", "No"], "recommended": "Yes"}
SUGGEST = ("/suggest", {"intent": "Crie um app web", "field": ENUM_FIELD})
COMPOSE = ("/compose", {"intent": "Crie um app web", "answers": [{"id": "a", "question": "Q", "answer": "A"}], "baseline": "B"})
PROVIDER_STATUS = {"model_not_found": 404, "auth_failed": 401, "provider_refused": 403, "provider_payment": 402,
                   "provider_bad_request": 400, "rate_limited": 429, "provider_timeout": 408}


def _engine_codes(monkeypatch) -> set[tuple[str, str]]:
    """(route, code) of every error the real /suggest and /compose answer in the scenarios below."""
    seen: set[tuple[str, str]] = set()

    def ask(route_body, **world):
        route, body = route_body
        _world(monkeypatch, **world)
        answer = _real_client().post(route, json=body)
        assert answer.status_code == 200, (route, world, answer.text)
        result = answer.json()
        assert result["ok"] is False, (route, world, result)
        seen.add((route, result["code"]))

    # Ends before any model call.
    ask(("/suggest", {**SUGGEST[1], "mode": "improve"}))
    ask(("/suggest", {"intent": "x", "mode": "improve", "answer": "y" * 1201, "field": {"question": "Q?"}}))
    # The model answers, wrongly.
    ask(SUGGEST, reply="not json")
    ask(SUGGEST, reply=json.dumps({"value": "Maybe"}))
    ask(COMPOSE, reply=json.dumps({"prompt": "too short"}))
    for route_body in (SUGGEST, COMPOSE):
        ask(route_body, reply="")
        # The provider call fails.
        ask(route_body, raises=RuntimeError("down"))
        for status in PROVIDER_STATUS.values():
            ask(route_body, raises=_Provider(status))
        # Hermes changed under the plugin: the model call lost a keyword the plugin sends.
        ask(route_body, **_override("agent.auxiliary_client", "call_llm", lambda *, task, messages: None))
        # No reply before the deadline.
        engine = plugin_api._load("suggest_engine", "suggest")
        monkeypatch.setattr(engine, "SUGGEST_DEADLINE", 0.2)
        monkeypatch.setattr(engine, "COMPOSE_DEADLINE", 0.2)
        ask(route_body, delay=0.6)
    return seen


def test_engine_codes_in_the_doc_are_the_codes_the_routes_answer(monkeypatch):
    assert _engine_codes(monkeypatch) == _doc_engine_pairs()


class _Store:
    def __init__(self, rows=None, known=True, raises: Exception | None = None):
        self.rows, self.known, self.raises = rows if rows is not None else [{"role": "user", "content": "hello", "active": 1, "compacted": 0}], known, raises

    def resolve_session_id(self, session_id):
        if self.raises:
            raise self.raises
        return session_id if self.known else None

    def get_messages(self, session_id, **kw):
        return self.rows

    def close(self):
        pass


def _context_codes(monkeypatch) -> set[str]:
    seen: set[str] = set()

    def ask(store=None, reply='{"summary": "ok"}', **world):
        overrides = {"hermes_cli.web_server_sessions._open_session_db_for_profile": lambda profile, *, read_only: store or _Store()}
        _world(monkeypatch, reply=reply, **overrides, **world)
        answer = _real_client().post("/context", json={"session_id": "s1"})
        assert answer.status_code == 200, answer.text
        result = answer.json()
        if result["ok"] is False:
            seen.add(result["code"])

    ask(_Store(known=False))
    ask(_Store(rows=[]))
    ask(_Store(raises=RuntimeError("db locked")))
    ask(reply="not json")
    ask(raises=RuntimeError("down"))
    for status in PROVIDER_STATUS.values():
        ask(raises=_Provider(status))
    ask(**_override("agent.auxiliary_client", "call_llm", lambda *, task, messages: None))
    monkeypatch.setattr(plugin_api._load("session_context", "context"), "CONTEXT_DEADLINE", 0.2)
    ask(delay=0.6)
    return seen


def test_context_codes_in_the_doc_are_the_codes_the_route_answers(monkeypatch):
    assert _context_codes(monkeypatch) == _doc_context_codes()


def test_bad_request_is_documented_as_unreachable_over_rest_and_is(monkeypatch):
    for header in (CONTEXT_HEADER, ENGINE_HEADER):
        assert UNREACHABLE in _doc_rows(header)["bad_request"]
    # The routes validate first: a client sees the 400/422 of the status table, never the engines' own bad_request.
    _world(monkeypatch)
    api = _real_client()
    assert "code" not in api.post("/suggest", json={"intent": " ", "field": {"question": "q"}}).json()
    assert "code" not in api.post("/compose", json={"intent": " "}).json()
    assert api.post("/context", json={"session_id": "has space"}).status_code == 422
    # The engines keep it for direct callers.
    engine, compose = plugin_api._load("suggest_engine", "suggest"), plugin_api._load("suggest_engine", "compose")
    assert engine.suggest({"intent": "", "field": {"question": "q"}})["code"] == "bad_request"
    assert compose.compose({"intent": ""})["code"] == "bad_request"
    assert plugin_api._load("session_context", "context").context({"session_id": "has space"})["code"] == "bad_request"
