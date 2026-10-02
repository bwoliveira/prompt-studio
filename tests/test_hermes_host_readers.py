"""host_incompatible through the session reader and /health (fake hosts; see test_hermes_host.py for the module)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parents[1] / "dashboard"
sys.path.insert(0, str(DASHBOARD))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_api  # noqa: E402
from test_hermes_host import _fake_hermes, _hermes_absent, _override  # noqa: E402


def _context():
    import importlib.util
    spec = importlib.util.spec_from_file_location("session_context_host_test", DASHBOARD / "session_context.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Db:
    def resolve_session_id(self, sid):
        return sid

    def get_messages(self, sid, **kw):
        return [{"role": "user", "content": "hello", "active": 1, "compacted": 0}]

    def close(self):
        pass


def test_context_answers_host_incompatible_when_the_redactor_changed(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.redact", "redact_sensitive_text", lambda text: text))
    sc = _context()
    called = []
    out = sc.context({"session_id": "s1"}, llm=lambda **kw: called.append(1) or ('{"summary": "x"}', "m"), opener=lambda p: _Db())
    assert out["ok"] is False and out["code"] == "host_incompatible" and not called


def test_context_answers_host_incompatible_when_the_session_store_changed(monkeypatch):
    _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile",
                                          lambda profile: None))
    sc = _context()
    out = sc.context({"session_id": "s1"}, llm=lambda **kw: ('{"summary": "x"}', "m"))
    assert out["ok"] is False and out["code"] == "host_incompatible"


def test_context_answers_host_incompatible_when_the_model_call_changed(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", lambda *, messages: None))
    sc = _context()
    out = sc.context({"session_id": "s1"}, opener=lambda p: _Db())
    assert out["ok"] is False and out["code"] == "host_incompatible"


def test_context_without_hermes_still_redacts_locally_and_opens_nothing(monkeypatch):
    _hermes_absent(monkeypatch)
    sc = _context()
    text = "key sk-abcdefghijklmnop1234"  # gitleaks:allow (fake key for the redaction test)
    assert "abcdefghijklmnop1234" not in sc.redact(text)


def test_health_reports_host_incompatible(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fake_hermes(monkeypatch, **_override("agent.redact", "redact_sensitive_text", lambda text: text))
    plugin_api._MODULES.clear()
    app = FastAPI()
    app.include_router(plugin_api.router)
    body = TestClient(app).get("/health").json()
    plugin_api._MODULES.clear()
    assert body["ok"] is False and body["code"] == "host_incompatible" and "force" not in json.dumps(body)
    assert body["error"].startswith("Hermes changed")


def test_health_stays_ok_on_a_compatible_host(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fake_hermes(monkeypatch)
    plugin_api._MODULES.clear()
    app = FastAPI()
    app.include_router(plugin_api.router)
    body = TestClient(app).get("/health").json()
    plugin_api._MODULES.clear()
    assert body == {"ok": True, "model": "p/m"}


def test_context_answers_host_incompatible_when_the_redactor_module_is_gone_not_the_local_fallback(monkeypatch):
    _fake_hermes(monkeypatch)
    monkeypatch.setitem(sys.modules, "agent.redact", None)
    sc = _context()
    called = []
    out = sc.context({"session_id": "s1"}, llm=lambda **kw: called.append(1) or ('{"summary": "x"}', "m"), opener=lambda p: _Db())
    assert out["ok"] is False and out["code"] == "host_incompatible" and not called


def test_health_reports_host_incompatible_when_an_installed_hermes_lost_a_module(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    _fake_hermes(monkeypatch)
    monkeypatch.setitem(sys.modules, "agent.auxiliary_client", None)
    plugin_api._MODULES.clear()
    app = FastAPI()
    app.include_router(plugin_api.router)
    body = TestClient(app).get("/health").json()
    plugin_api._MODULES.clear()
    assert body["ok"] is False and body["code"] == "host_incompatible"
