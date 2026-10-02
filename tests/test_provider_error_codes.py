"""#32: one table maps a failed provider call to its error code; /suggest, /compose and /context all use it."""
from __future__ import annotations

import importlib.util
import inspect
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))
import llm_adapter as adapter  # noqa: E402


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", ROOT / "dashboard" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _status(code, text="x", via_response=False):
    exc = Exception(text)
    if via_response:
        exc.response = type("Resp", (), {"status_code": code})()
    else:
        exc.status_code = code
    return exc


def _named(name, text="x", base=Exception):
    return type(name, (base,), {})(text)


class APITimeoutError(Exception):  # shape of openai/anthropic APITimeoutError
    pass


class TimeoutException(Exception):  # httpx's base for its timeouts
    pass


class ReadTimeout(TimeoutException):  # shape of httpx.ReadTimeout
    pass

# (exception, code, ui sentence the context route and the prefix of the suggest/compose error carry)
TABLE = [
    (_status(404), "model_not_found", "model not found"),
    (_named("NotFoundError"), "model_not_found", "model not found"),
    (_status(401), "auth_failed", "auth failed"),
    (_status(401, via_response=True), "auth_failed", "auth failed"),
    (_named("AuthenticationError"), "auth_failed", "auth failed"),
    (_status(401, "insufficient_quota"), "auth_failed", "auth failed"),
    (_status(403), "provider_refused", "provider refused"),
    (_status(403, via_response=True), "provider_refused", "provider refused"),
    (_named("PermissionDeniedError"), "provider_refused", "provider refused"),
    (Exception("Error code: MODEL_NOT_IN_PLAN"), "provider_refused", "provider refused"),
    (Exception("model is Not In Plan"), "provider_refused", "provider refused"),
    (_status(403, "insufficient_quota"), "provider_refused", "provider refused"),
    (_status(402), "provider_payment", "provider payment"),
    (_status(429, "insufficient_quota"), "provider_payment", "provider payment"),
    (_status(400, "billing_hard_limit_reached"), "provider_payment", "provider payment"),
    (_status(400), "provider_bad_request", "provider bad request"),
    (_named("BadRequestError"), "provider_bad_request", "provider bad request"),
    (_status(429), "rate_limited", "rate limited"),
    (_status(429, via_response=True), "rate_limited", "rate limited"),
    (_named("RateLimitError"), "rate_limited", "rate limited"),
    (_status(429, "Rate limit reached. See billing documentation."), "rate_limited", "rate limited"),
    (TimeoutError("read timed out"), "provider_timeout", "provider timeout"),
    (APITimeoutError("Request timed out."), "provider_timeout", "provider timeout"),
    (ReadTimeout("The read operation timed out"), "provider_timeout", "provider timeout"),
    (_status(408), "provider_timeout", "provider timeout"),
    (_status(504), "provider_timeout", "provider timeout"),
    (_status(500), "unavailable", "model unavailable"),
    (_status(503, "Billing service temporarily unavailable"), "unavailable", "model unavailable"),
    (RuntimeError("provider down"), "unavailable", "model unavailable"),
]
IDS = [f"{type(e).__name__}-{getattr(e, 'status_code', None) or getattr(getattr(e, 'response', None), 'status_code', '')}-{c}-{i}"
       for i, (e, c, _) in enumerate(TABLE)]


@pytest.mark.parametrize("exc,code,sentence", TABLE, ids=IDS)
def test_the_classifier_maps_each_status_and_exception_to_its_code(exc, code, sentence):
    assert adapter.provider_error_code(exc) == code
    assert adapter.provider_error_sentence(code) == sentence


def test_a_changed_hermes_classifier_is_host_incompatible_not_a_provider_code(monkeypatch):
    def changed(_):
        raise adapter.host.HostIncompatible("classifier changed")

    monkeypatch.setattr(adapter.host, "is_model_not_found_error", changed)
    assert adapter.provider_error_code(RuntimeError("down")) == "host_incompatible"
    assert adapter.provider_error_code(adapter.host.HostIncompatible("x")) == "host_incompatible"


BASE = {"target": "opus", "intent": "Crie um dashboard de gastos da casa", "ladder": [{"question": "Entrega?", "answer": "Funcional"}]}
FIELD = {"id": "autonomy", "kind": "enum", "question": "Autonomia?", "options": ["Equilibrada", "Tomar iniciativa"], "recommended": "Equilibrada"}
COMPOSE = {"target": "opus", "intent": "Crie um app", "answers": [], "baseline": "TASK\nCrie um app"}


def _failing(exc):
    def llm(**_):
        raise exc

    return llm


class _DB:
    def resolve_session_id(self, sid):
        return sid

    def get_messages(self, sid, **kw):
        return [{"role": "user", "content": "hello"}]

    def close(self):
        pass


@pytest.mark.parametrize("exc,code,sentence", TABLE, ids=IDS)
def test_suggest_compose_and_context_answer_the_same_code(exc, code, sentence):
    se, sc = _load("suggest_engine"), _load("session_context")
    suggested = se.suggest({**BASE, "field": FIELD}, llm=_failing(exc))
    composed = se.compose(COMPOSE, llm=_failing(exc))
    context = sc.context({"session_id": "s1"}, llm=_failing(exc), opener=lambda profile: _DB())
    assert suggested["code"] == composed["code"] == context["code"] == code, (suggested, composed, context)
    assert suggested["error"] == f"{sentence}: {type(exc).__name__}"
    assert composed["error"] == suggested["error"]
    assert context["error"] == sentence


def test_the_context_reader_has_no_classifier_of_its_own():
    source = inspect.getsource(_load("session_context"))
    assert re.search(r"is_provider_|is_model_not_found|status_code", source) is None, "classification lives in llm_adapter"


def test_every_provider_code_is_documented_and_has_localized_text():
    contract = (ROOT / "docs" / "CONTRACT.md").read_text()
    ui = (ROOT / "desktop" / "src" / "i18n-ui.js").read_text()
    codes = [code for code, _, _ in adapter.PROVIDER_ERRORS]
    for code in codes + ["unavailable"]:
        assert contract.count(f"| `{code}` |") >= 2, f"{code}: one row in the /context table and one in the /suggest table"
    for code in codes:
        assert len(re.findall(rf"^\s+{code}: key =>", ui, re.MULTILINE)) == 2, f"{code}: errors.{code} in en and pt"
    assert {"auth_failed", "rate_limited", "provider_timeout"} <= set(codes)


def test_the_readme_troubleshooting_names_each_provider_failure_apart():
    # The provider troubleshooting note lives in docs/CONFIGURATION.md; the README names the codes and links there.
    readme = " ".join((ROOT / "README.md").read_text().split())
    assert "(401, 402, 403, 400, 429, timeouts)" in readme and "docs/CONFIGURATION.md" in readme
    config = " ".join((ROOT / "docs" / "CONFIGURATION.md").read_text().split())
    start = config.index("If suggestions fail with")
    note = config[start:start + 700]
    assert "provider refused" in note and "(403" in note and "(401/403)" not in note
    assert re.search(r"API key not accepted\W+\(401\)", note), note
    assert "(429)" in note and "timed out" in note, note
