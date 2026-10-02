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
    r = api.post("/compose", json={"target": "sonnet", "intent": "Crie um app", "answers": [], "baseline": "B"})
    assert r.status_code == 200 and fake.calls[-1]["target"] == "sonnet"


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


# ---- #25: over-limit text is reported, not cut silently (real engine, stub model) ----
def engine_client(monkeypatch, reply):
    import json

    spec = importlib.util.spec_from_file_location("suggest_engine_api_test", Path(plugin_api.__file__).with_name("suggest_engine.py"))
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    calls = []

    def llm(messages, max_tokens, timeout, is_json=False):
        calls.append(messages)
        return json.dumps(reply), "stub/model"

    class Bound:
        suggest = staticmethod(lambda payload: engine.suggest(payload, llm=llm))
        compose = staticmethod(lambda payload: engine.compose(payload, llm=llm))

    monkeypatch.setattr(plugin_api, "_load", lambda name, attr: Bound if name == "suggest_engine" else FakeEngine())
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app), calls, engine


TEXT_FIELD = {"id": "context", "kind": "text", "question": "Contexto?"}


def test_suggest_improve_over_the_model_limit_returns_too_long_over_http(monkeypatch):
    api, calls, engine = engine_client(monkeypatch, {"value": "- Casa", "reason": "ok"})
    body = {"intent": "Crie um app", "field": TEXT_FIELD, "mode": "improve", "answer": "x" * (engine.TEXT_LIMIT + 1)}
    response = api.post("/suggest", json=body)
    assert response.status_code == 200
    assert response.json()["ok"] is False and response.json()["code"] == "too_long"
    assert response.json()["limit"] == engine.TEXT_LIMIT
    assert calls == []
    ok = api.post("/suggest", json={**body, "answer": "x" * engine.TEXT_LIMIT}).json()
    assert ok["ok"] is True and "truncated" not in ok


def test_routes_carry_truncated_when_the_engine_cut_the_text(monkeypatch):
    api, calls, engine = engine_client(monkeypatch, {"value": "Equilibrada", "reason": "ok", "prompt": "Improved prompt text long enough to pass.", "notes": ""})
    suggest = {"intent": "d" * (engine.INTENT_LIMIT + 1), "field": FIELD}
    assert api.post("/suggest", json=suggest).json()["truncated"] is True
    assert "truncated" not in api.post("/suggest", json={**suggest, "intent": "d" * engine.INTENT_LIMIT}).json()
    compose = {"intent": "Crie um app", "baseline": "b" * (engine.COMPOSE_LIMIT + 1)}
    assert api.post("/compose", json=compose).json()["truncated"] is True
    compose["baseline"] = "b" * engine.COMPOSE_LIMIT
    assert "truncated" not in api.post("/compose", json=compose).json()
# ---- #27: modules and thread pools are created once per process ----
import os  # noqa: E402
import shutil  # noqa: E402

DASHBOARD = Path(__file__).resolve().parents[1] / "dashboard"


@pytest.fixture(autouse=True)
def _fresh_module_cache(monkeypatch):
    monkeypatch.delenv("PROMPT_STUDIO_DEV_RELOAD", raising=False)
    plugin_api._MODULES.clear()
    yield
    plugin_api._MODULES.clear()


def _host_load(directory: Path):
    """Load plugin_api.py by path the way the Hermes dashboard does (no package, empty __package__)."""
    spec = importlib.util.spec_from_file_location("hermes_dashboard_plugin_prompt-studio", directory / "plugin_api.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    assert not mod.__package__
    return mod


def _requests(mod):
    return {n: mod._load(n, a) for n, a in (("suggest_engine", "suggest"), ("session_context", "context"), ("llm_adapter", "get_model_label"))}


def test_by_path_loading_keeps_the_same_modules_and_executors_across_requests():
    mod = _host_load(DASHBOARD)
    first, second = _requests(mod), _requests(mod)
    for name in first:
        assert first[name] is second[name], name
    assert first["suggest_engine"]._EXECUTOR is second["suggest_engine"]._EXECUTOR
    assert first["suggest_engine"]._COMPOSE_EXECUTOR is second["suggest_engine"]._COMPOSE_EXECUTOR
    assert first["suggest_engine"]._EXECUTOR is not first["suggest_engine"]._COMPOSE_EXECUTOR
    assert first["session_context"]._EXECUTOR is second["session_context"]._EXECUTOR


def test_health_route_reuses_the_loaded_adapter():
    mod = _host_load(DASHBOARD)
    app = FastAPI()
    app.include_router(mod.router)
    http = TestClient(app)
    http.get("/health")
    adapter = mod._MODULES["llm_adapter"][1]
    http.get("/health")
    assert mod._MODULES["llm_adapter"][1] is adapter


def test_a_changed_file_mtime_reloads_the_modules(tmp_path):
    copy = tmp_path / "dashboard"
    shutil.copytree(DASHBOARD, copy, ignore=shutil.ignore_patterns("__pycache__"))
    mod = _host_load(copy)
    before = mod._load("suggest_engine", "suggest")
    engine_file = copy / "suggest_engine.py"
    stat = engine_file.stat()
    os.utime(engine_file, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    after = mod._load("suggest_engine", "suggest")
    assert after is not before
    assert mod._load("suggest_engine", "suggest") is after


def test_dev_switch_reloads_on_every_request(monkeypatch):
    mod = _host_load(DASHBOARD)
    monkeypatch.setenv("PROMPT_STUDIO_DEV_RELOAD", "1")
    first = mod._load("suggest_engine", "suggest")
    assert mod._load("suggest_engine", "suggest") is not first
    monkeypatch.setenv("PROMPT_STUDIO_DEV_RELOAD", "0")
    stable = mod._load("suggest_engine", "suggest")
    assert mod._load("suggest_engine", "suggest") is stable


def test_package_path_reloads_only_when_the_files_changed(monkeypatch):
    module = types.SimpleNamespace(suggest=lambda p: p)
    reloads = []
    monkeypatch.setattr(plugin_api, "__package__", "fakepkg")
    monkeypatch.setattr(plugin_api.importlib, "import_module", lambda *a, **k: module)
    monkeypatch.setattr(plugin_api.importlib, "reload", lambda m: reloads.append(m) or m)
    plugin_api._load("suggest_engine", "suggest")
    plugin_api._load("suggest_engine", "suggest")
    assert len(reloads) == 1


# ---- #27: a same-size edit within the same second must not run stale bytecode ----
@pytest.mark.parametrize("mode", ["standalone", "package"])
def test_reload_runs_the_new_source_when_a_stale_pyc_matches_second_and_size(tmp_path, monkeypatch, mode):
    import os
    import py_compile

    pkg = tmp_path / f"psbytecode_{mode}"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    real = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    (pkg / "plugin_api.py").write_text(real.read_text())
    engine = pkg / "suggest_engine.py"

    def write(effort: str, mtime_ns: int) -> None:
        engine.write_text(f'DEFAULT_EFFORT = "{effort}"\n\n\ndef suggest(payload):\n    return DEFAULT_EFFORT\n')
        os.utime(engine, ns=(mtime_ns, mtime_ns))

    base = 1_700_000_000_200_000_000  # xxx.2 s
    write("one", base)
    if mode == "package":
        monkeypatch.syspath_prepend(str(tmp_path))
        api = importlib.import_module(f"{pkg.name}.plugin_api")
    else:
        spec = importlib.util.spec_from_file_location(f"{pkg.name}_plugin_api", pkg / "plugin_api.py")
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
    try:
        assert api._load("suggest_engine", "suggest").suggest({}) == "one"
        # Leave a .pyc for the OLD source on disk, as a previous process or run would have.
        py_compile.compile(str(engine), doraise=True)
        write("two", base + 100_000_000)  # same byte length, same integer second, mtime +100 ms
        assert api._load("suggest_engine", "suggest").suggest({}) == "two"
    finally:
        for name in [n for n in sys.modules if n.startswith(pkg.name)]:
            del sys.modules[name]


# ---- #27 (Codex P2): an edit of the adapter the engine imports is picked up when the engine reloads ----
ENGINE_WITH_ADAPTER = (
    "try:\n"
    "    from . import llm_adapter as _llm\n"
    "except ImportError:\n"
    "    import importlib.util\n"
    "    from pathlib import Path\n"
    "    _spec = importlib.util.spec_from_file_location('prompt_studio_llm_adapter', Path(__file__).with_name('llm_adapter.py'))\n"
    "    _llm = importlib.util.module_from_spec(_spec)\n"
    "    _spec.loader.exec_module(_llm)\n"
    "\n\ndef suggest(payload):\n    return _llm.LABEL\n"
)


@pytest.mark.parametrize("mode", ["standalone", "package"])
def test_reload_refreshes_the_adapter_the_engine_imports(tmp_path, monkeypatch, mode):
    import os
    import py_compile

    pkg = tmp_path / f"psadapter_{mode}"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    real = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    (pkg / "plugin_api.py").write_text(real.read_text())
    (pkg / "suggest_engine.py").write_text(ENGINE_WITH_ADAPTER)
    adapter = pkg / "llm_adapter.py"

    def write(label: str, mtime_ns: int) -> None:
        adapter.write_text(f'LABEL = "{label}"\n\n\ndef get_model_label():\n    return LABEL\n')
        os.utime(adapter, ns=(mtime_ns, mtime_ns))

    base = 1_700_000_000_200_000_000  # xxx.2 s
    write("one", base)
    if mode == "package":
        monkeypatch.syspath_prepend(str(tmp_path))
        api = importlib.import_module(f"{pkg.name}.plugin_api")
    else:
        spec = importlib.util.spec_from_file_location(f"{pkg.name}_plugin_api", pkg / "plugin_api.py")
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
    try:
        assert api._load("suggest_engine", "suggest").suggest({}) == "one"
        # Stale .pyc of the OLD adapter, then a same-size edit inside the same second: only the adapter changed.
        py_compile.compile(str(adapter), doraise=True)
        write("two", base + 100_000_000)
        assert api._load("suggest_engine", "suggest").suggest({}) == "two"
        assert api._load("llm_adapter", "get_model_label").get_model_label() == "two"
    finally:
        for name in [n for n in sys.modules if n.startswith(pkg.name)]:
            del sys.modules[name]
