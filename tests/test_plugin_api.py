from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import plugin_api  # noqa: E402


class FakeSuggest:
    def __init__(self):
        self.calls = []

    def compose(self, payload):
        self.calls.append(payload)
        return {"ok": True, "prompt": "Prompt final da IA.", "notes": "ok", "model": "fake/model"}

    def suggest(self, payload):
        self.calls.append(payload)
        return {"ok": True, "value": "Tomar iniciativa", "reason": "Pedido direto.", "model": "fake/model", "latency_ms": 1, "source": "model"}


class FakeEngine:
    def get_model_label(self):
        return "fake/model"


def client(monkeypatch):
    fake = FakeSuggest()
    monkeypatch.setattr(plugin_api, "_load", lambda name, attr: fake if name == "suggest_engine" else FakeEngine())
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app), fake


FIELD = {"id": "autonomy", "kind": "enum", "question": "Autonomia?", "options": ["Equilibrada", "Tomar iniciativa"], "recommended": "Equilibrada"}


def test_suggest_route_passes_the_field_and_returns_the_engine_result(monkeypatch):
    api, fake = client(monkeypatch)
    response = api.post("/suggest", json={"target": "opus", "intent": "Crie um app", "ladder": [{"question": "Q", "answer": "A"}], "field": FIELD})
    assert response.status_code == 200
    assert response.json()["value"] == "Tomar iniciativa"
    assert fake.calls[0]["field"]["options"] == ["Equilibrada", "Tomar iniciativa"]
    assert fake.calls[0]["ladder"][0]["answer"] == "A"


def test_suggest_route_rejects_incomplete_requests(monkeypatch):
    api, fake = client(monkeypatch)
    assert api.post("/suggest", json={"intent": "  ", "field": FIELD}).status_code == 400
    assert api.post("/suggest", json={"intent": "Crie um app", "field": {**FIELD, "question": " "}}).status_code == 400
    assert api.post("/suggest", json={"intent": "Crie um app"}).status_code == 422
    assert fake.calls == []


def test_suggest_route_reports_engine_crash(monkeypatch):
    def broken(name, attr):
        raise RuntimeError("boom")

    monkeypatch.setattr(plugin_api, "_load", broken)
    app = FastAPI()
    app.include_router(plugin_api.router)
    response = TestClient(app).post("/suggest", json={"intent": "Crie um app", "field": FIELD})
    assert response.status_code == 500 and response.json()["ok"] is False


def test_v1_routes_are_gone_and_health_reports_the_model(monkeypatch):
    api, _ = client(monkeypatch)
    assert api.post("/interrogate", json={"text": "x"}).status_code == 404
    assert api.post("/brief", json={"text": "x"}).status_code == 404
    assert api.get("/health").json() == {"ok": True, "model": "fake/model"}


def test_real_loader_finds_both_engines():
    assert hasattr(plugin_api._load("suggest_engine", "suggest"), "suggest")
    assert hasattr(plugin_api._load("llm_adapter", "get_model_label"), "get_model_label")


def test_standalone_spec_loader():
    # `hermes serve` imports plugin_api.py by path, without a package; the siblings must still load.
    api_path = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermes_dashboard_plugin_test", api_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert hasattr(mod._load("suggest_engine", "suggest"), "suggest")


def test_compose_route(monkeypatch):
    api, fake = client(monkeypatch)
    r = api.post("/compose", json={"target": "astra", "intent": "Crie um app", "answers": [{"id": "context", "question": "Q", "answer": "A"}], "baseline": "B"})
    assert r.status_code == 200 and r.json()["prompt"] == "Prompt final da IA."
    assert fake.calls[0]["answers"][0]["answer"] == "A" and fake.calls[0]["baseline"] == "B"
    assert api.post("/compose", json={"intent": " "}).status_code == 400


def test_routes_pass_every_field_the_desktop_sends(monkeypatch):
    # pydantic drops undeclared fields: guide, kind and isDefault must survive the request models.
    api, fake = client(monkeypatch)
    field = {**FIELD, "guide": "never invent an example"}
    assert api.post("/suggest", json={"intent": "Crie um app", "field": field}).status_code == 200
    assert fake.calls[-1]["field"]["guide"] == "never invent an example"
    answers = [
        {"id": "autonomy", "kind": "enum", "question": "Q", "answer": "Equilibrada", "isDefault": True},
        {"id": "examples", "kind": "example", "question": "Q", "answer": "Olá"},
    ]
    assert api.post("/compose", json={"intent": "Crie um app", "answers": answers, "baseline": "B"}).status_code == 200
    sent = fake.calls[-1]["answers"]
    assert sent[0]["kind"] == "enum" and sent[0]["isDefault"] is True
    assert sent[1]["kind"] == "example"


# ---- v1.0.0: health reports load failures (A5, C8), loader contract (C7), locale field ----
import logging  # noqa: E402
import types  # noqa: E402

import pytest  # noqa: E402


def _broken_client(monkeypatch):
    def broken(name, attr):
        raise RuntimeError("boom")

    monkeypatch.setattr(plugin_api, "_load", broken)
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app)


def test_health_reports_a_broken_adapter_and_logs_it(monkeypatch, caplog):
    api = _broken_client(monkeypatch)
    with caplog.at_level(logging.ERROR):
        body = api.get("/health").json()
    assert body["ok"] is False and body["error"]
    assert sum(r.levelno == logging.ERROR for r in caplog.records) == 1


def test_loader_checks_the_function_on_the_package_path_too(monkeypatch):
    monkeypatch.setattr(plugin_api, "__package__", "fakepkg")
    monkeypatch.setattr(plugin_api.importlib, "import_module", lambda *a, **k: types.SimpleNamespace())
    monkeypatch.setattr(plugin_api.importlib, "reload", lambda m: m)
    with pytest.raises(RuntimeError, match="suggest_engine.suggest missing"):
        plugin_api._load("suggest_engine", "suggest")


def test_loader_logs_a_failed_reload(monkeypatch, caplog):
    module = types.SimpleNamespace(suggest=lambda p: p)
    monkeypatch.setattr(plugin_api, "__package__", "fakepkg")
    monkeypatch.setattr(plugin_api.importlib, "import_module", lambda *a, **k: module)

    def bad_reload(m):
        raise ImportError("syntax")

    monkeypatch.setattr(plugin_api.importlib, "reload", bad_reload)
    with caplog.at_level(logging.DEBUG, logger=plugin_api.logger.name):
        assert plugin_api._load("suggest_engine", "suggest") is module
    assert any("reload" in r.getMessage() for r in caplog.records)


def test_locale_reaches_both_engines_and_defaults_to_en(monkeypatch):
    api, fake = client(monkeypatch)
    api.post("/suggest", json={"intent": "x", "field": FIELD, "locale": "pt"})
    assert fake.calls[-1]["locale"] == "pt"
    api.post("/suggest", json={"intent": "x", "field": FIELD})
    assert fake.calls[-1]["locale"] == "en"
    api.post("/compose", json={"intent": "x", "locale": "pt"})
    assert fake.calls[-1]["locale"] == "pt"
    api.post("/compose", json={"intent": "x"})
    assert fake.calls[-1]["locale"] == "en"


def test_oversized_requests_are_rejected_before_the_engine(monkeypatch):
    c, fake = client(monkeypatch)
    big = "x" * 250_001
    assert c.post("/compose", json={"intent": big}).status_code == 422
    assert c.post("/compose", json={"intent": "ok", "answers": [{"answer": "a"}] * 51}).status_code == 422
    assert c.post("/suggest", json={"intent": "ok", "field": {**FIELD, "options": ["o"] * 51}}).status_code == 422
    assert c.post("/suggest", json={"intent": "ok", "field": FIELD, "ladder": [{"answer": "a"}] * 51}).status_code == 422
    assert c.post("/suggest", json={"intent": "ok", "field": {**FIELD, "question": "q" * 20_001}}).status_code == 422
    assert fake.calls == []
    # Realistic big payloads still pass.
    assert c.post("/compose", json={"intent": "y" * 100_000, "baseline": "z" * 200_000, "answers": [{"answer": "a" * 20_000}] * 50}).status_code == 200


def test_every_request_string_and_list_has_a_max_length():
    for model in (plugin_api.LadderRung, plugin_api.SuggestField, plugin_api.SuggestRequest, plugin_api.ComposeAnswer, plugin_api.ComposeRequest):
        for name, f in model.model_fields.items():
            if name in ("field", "isDefault", "model_choice"):
                continue
            assert any(getattr(m, "max_length", None) for m in f.metadata), f"{model.__name__}.{name}"


# ---- fix round 3 (CT-08): loader fallback and engine-unavailable branches ----
def test_loader_falls_back_to_the_file_when_the_package_import_fails(monkeypatch):
    monkeypatch.setattr(plugin_api, "__package__", "fakepkg")

    def no_package(*a, **k):
        raise ImportError("no package")

    monkeypatch.setattr(plugin_api.importlib, "import_module", no_package)
    assert hasattr(plugin_api._load("suggest_engine", "compose"), "compose")


def test_loader_reports_a_missing_sibling_file(monkeypatch):
    monkeypatch.setattr(plugin_api, "__package__", None)
    monkeypatch.setattr(plugin_api.importlib.util, "spec_from_file_location", lambda *a, **k: None)
    with pytest.raises(RuntimeError, match="nope could not be loaded"):
        plugin_api._load("nope", "x")


def test_compose_route_reports_engine_crash_as_documented_500(monkeypatch, caplog):
    api = _broken_client(monkeypatch)
    with caplog.at_level(logging.ERROR):
        response = api.post("/compose", json={"intent": "Crie um app"})
    assert response.status_code == 500
    assert response.json() == {"ok": False, "error": "compose engine unavailable"}
    assert any("compose" in r.getMessage() for r in caplog.records)


def test_suggest_route_engine_crash_body_is_the_documented_500(monkeypatch):
    response = _broken_client(monkeypatch).post("/suggest", json={"intent": "Crie um app", "field": FIELD})
    assert response.status_code == 500 and response.json() == {"ok": False, "error": "suggest engine unavailable"}


# --- CX-1: /context route, model_choice and session_context fields.
class FakeContext:
    def __init__(self):
        self.calls = []

    def context(self, payload):
        self.calls.append(payload)
        return {"ok": True, "summary": "s", "model": "fake/ctx", "turns": 1, "ms": 5}


def _ctx_client(monkeypatch):
    fake, ctx = FakeSuggest(), FakeContext()
    monkeypatch.setattr(plugin_api, "_load", lambda name, attr: {"suggest_engine": fake, "session_context": ctx}.get(name, FakeEngine()))
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app), fake, ctx


CHOICE = {"provider": "anthropic", "model": "claude-haiku-5", "effort": "low"}


def test_context_route_passes_the_request_to_the_reader(monkeypatch):
    api, _, ctx = _ctx_client(monkeypatch)
    r = api.post("/context", json={"session_id": "abc_1.2:3-x", "profile": "work", "locale": "pt", "model_choice": CHOICE})
    assert r.status_code == 200 and r.json()["summary"] == "s"
    assert ctx.calls[0] == {"session_id": "abc_1.2:3-x", "profile": "work", "locale": "pt", "model_choice": CHOICE}


@pytest.mark.parametrize("body", [
    {"session_id": "../x"}, {"session_id": ""}, {"session_id": "x" * 129}, {},
    {"session_id": "s", "profile": "a/b"}, {"session_id": "s", "profile": "p" * 65},
    {"session_id": "s", "model_choice": {"provider": "p", "model": "m", "effort": "turbo"}},
    {"session_id": "s", "model_choice": {"provider": "p" * 81, "model": "m"}},
    {"session_id": "s", "model_choice": {"provider": "p", "model": "m" * 201}},
])
def test_context_route_rejects_malformed_requests(monkeypatch, body):
    api, _, ctx = _ctx_client(monkeypatch)
    assert api.post("/context", json=body).status_code == 422 and ctx.calls == []


def test_context_route_reports_a_broken_reader(monkeypatch, caplog):
    monkeypatch.setattr(plugin_api, "_load", lambda name, attr: (_ for _ in ()).throw(RuntimeError("x")))
    app = FastAPI()
    app.include_router(plugin_api.router)
    with caplog.at_level(logging.ERROR):
        r = TestClient(app).post("/context", json={"session_id": "s"})
    assert r.status_code == 200 and r.json() == {"ok": False, "code": "unavailable", "error": "context reader unavailable"}


def test_model_choice_and_session_context_reach_the_engines(monkeypatch):
    api, fake, _ = _ctx_client(monkeypatch)
    api.post("/suggest", json={"intent": "x", "field": FIELD, "model_choice": CHOICE, "session_context": "ctx"})
    assert fake.calls[-1]["model_choice"] == CHOICE and fake.calls[-1]["session_context"] == "ctx"
    api.post("/compose", json={"intent": "x", "model_choice": CHOICE, "session_context": "ctx"})
    assert fake.calls[-1]["model_choice"] == CHOICE and "session_context" not in fake.calls[-1]
    for effort in ("", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"):
        assert api.post("/compose", json={"intent": "x", "model_choice": {**CHOICE, "effort": effort}}).status_code == 200
    assert api.post("/compose", json={"intent": "x", "model_choice": {**CHOICE, "effort": "turbo"}}).status_code == 422
    assert api.post("/suggest", json={"intent": "x", "field": FIELD, "session_context": "c" * 3001}).status_code == 422


def test_new_request_models_are_bounded():
    for model in (plugin_api.ModelChoice, plugin_api.ContextRequest):
        for name, f in model.model_fields.items():
            if name == "model_choice":
                continue
            assert any(getattr(m, "max_length", None) for m in f.metadata), f"{model.__name__}.{name}"


def test_real_loader_finds_the_context_reader():
    assert hasattr(plugin_api._load("session_context", "context"), "context")
