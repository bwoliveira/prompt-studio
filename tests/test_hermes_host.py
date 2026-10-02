"""The Hermes host module: every Hermes-internal import of the backend goes through dashboard/hermes_host.py.

Fake hosts only (no Hermes needed). ``tests/test_hermes_host_contract.py`` checks the same signatures against the
real install.
"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
sys.path.insert(0, str(DASHBOARD))
import llm_adapter as adapter  # noqa: E402
import plugin_api  # noqa: E402

# The copy the adapter loaded: exception classes must be the ones its calls raise.
host = adapter.host


# --- fake Hermes -----------------------------------------------------------------------------------------------
def _call_llm(*, task=None, provider=None, model=None, messages, max_tokens=None, timeout=None, extra_body=None,
              reasoning_config=None, route_info=None):
    return {"choices": []}


def _fake_hermes(monkeypatch, **overrides):
    """Install fake agent.auxiliary_client / agent.redact / hermes_constants / hermes_cli / hermes_state.

    ``overrides`` replaces any attribute by ``"<module>.<name>"`` (``None`` removes it).
    """
    store_calls = {"opened": [], "closed": 0}

    class Store:
        def resolve_session_id(self, session_id):
            return session_id

        def resolve_resume_session_id(self, session_id):
            return session_id

        def get_messages(self, session_id, include_inactive=False, include_compacted=False, limit=None, offset=0,
                         latest=False):
            return []

        def close(self):
            store_calls["closed"] += 1

    def open_helper(profile, *, read_only):
        store_calls["opened"].append((profile, read_only))
        return Store()

    class SessionDB(Store):
        def __init__(self, db_path=None, read_only=False):
            store_calls["opened"].append(("SessionDB", read_only))

    attrs = {
        "agent.auxiliary_client": {
            "call_llm": _call_llm,
            "extract_content_or_reasoning": lambda response, *, max_reasoning_chars=None: "text",
            "_get_auxiliary_task_config": lambda task: {"timeout": 5},
            "_resolve_task_provider_model": lambda task=None, provider=None, model=None, base_url=None, api_key=None: (
                "p", "m", None, None, None),
            "_is_model_not_found_error": lambda exc: "nf" in str(exc),
        },
        "agent.redact": {"redact_sensitive_text": lambda text, *, force=False, code_file=False: "<" + text + ">"},
        "hermes_constants": {"parse_reasoning_effort": lambda effort: {"enabled": True, "effort": effort}},
        "hermes_cli.web_server_sessions": {"_open_session_db_for_profile": open_helper},
        "hermes_state": {"SessionDB": SessionDB},
    }
    for key, value in overrides.items():
        module_name, name = key.rsplit(".", 1)
        if value is None:
            attrs[module_name].pop(name, None)
        else:
            attrs[module_name][name] = value
    for name in ("agent", "hermes_cli"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    for name, members in attrs.items():
        module = types.ModuleType(name)
        for member, value in members.items():
            setattr(module, member, value)
        monkeypatch.setitem(sys.modules, name, module)
    return store_calls


def _override(module: str, name: str, value) -> dict:
    return {f"{module}.{name}": value}


def _hermes_absent(monkeypatch):
    for name in ("agent", "agent.auxiliary_client", "agent.redact", "hermes_constants", "hermes_cli",
                 "hermes_cli.web_server_sessions", "hermes_state"):
        monkeypatch.setitem(sys.modules, name, None)  # an import now raises ImportError


# --- the compatible host works through the module ---------------------------------------------------------------
def test_a_compatible_host_runs_every_call_through_the_module(monkeypatch):
    seen = {}
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm",
                                          lambda **kw: seen.update(kw) or {"choices": []}))
    assert host.call_llm(task="prompt_studio", messages=[], max_tokens=5, timeout=1.0, route_info={}, extra_body=None,
                         reasoning_config=None) == {"choices": []}
    assert seen["task"] == "prompt_studio" and "temperature" not in seen
    assert host.extract_content_or_reasoning({"content": "x"}) == "text"
    assert host.auxiliary_task_config("prompt_studio") == {"timeout": 5}
    assert host.resolve_route("prompt_studio") == ("p", "m", None, None, None)
    assert host.parse_reasoning_effort("low") == {"enabled": True, "effort": "low"}
    assert host.is_model_not_found_error(Exception("nf")) is True
    assert host.redact_sensitive_text("abc") == "<abc>"


def test_the_error_code_is_stable():
    assert host.CODE == "host_incompatible" and host.HostIncompatible.code == "host_incompatible"
    assert issubclass(host.HostUnavailable, ImportError) and not issubclass(host.HostIncompatible, ImportError)


# --- a changed host raises host_incompatible, never a half call --------------------------------------------------
def test_a_call_llm_that_lost_a_keyword_the_plugin_sends_is_host_incompatible(monkeypatch):
    called = []

    def call_llm(*, task=None, provider=None, model=None, messages, max_tokens=None, timeout=None, extra_body=None,
                 reasoning_config=None):  # route_info dropped
        called.append(1)

    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", call_llm))
    with pytest.raises(host.HostIncompatible, match="route_info"):
        host.call_llm(task="prompt_studio", messages=[], max_tokens=5, timeout=1.0, route_info={}, extra_body=None,
                      reasoning_config=None)
    assert not called


def test_a_call_llm_with_a_new_required_argument_is_host_incompatible(monkeypatch):
    def call_llm(*, task=None, messages, max_tokens=None, timeout=None, extra_body=None, reasoning_config=None,
                 route_info=None, provider=None, model=None, tenant):
        raise AssertionError("must not be called")

    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", call_llm))
    with pytest.raises(host.HostIncompatible, match="tenant"):
        host.call_llm(task="prompt_studio", messages=[])


@pytest.mark.parametrize("module,name", [
    ("agent.auxiliary_client", "call_llm"), ("agent.auxiliary_client", "extract_content_or_reasoning"),
    ("agent.auxiliary_client", "_get_auxiliary_task_config"), ("agent.auxiliary_client", "_resolve_task_provider_model"),
    ("agent.redact", "redact_sensitive_text"), ("hermes_constants", "parse_reasoning_effort"),
])
def test_a_renamed_symbol_is_host_incompatible_not_unavailable(monkeypatch, module, name):
    _fake_hermes(monkeypatch, **_override(module, name, None))
    with pytest.raises(host.HostIncompatible, match=name):
        {
            "call_llm": lambda: host.call_llm(messages=[]),
            "extract_content_or_reasoning": lambda: host.extract_content_or_reasoning({}),
            "_get_auxiliary_task_config": lambda: host.auxiliary_task_config("t"),
            "_resolve_task_provider_model": lambda: host.resolve_route("t"),
            "redact_sensitive_text": lambda: host.redact_sensitive_text("x"),
            "parse_reasoning_effort": lambda: host.parse_reasoning_effort("low"),
        }[name]()


@pytest.mark.parametrize("result", [("p", "m", None, None), ("p", "m", None, None, None, "x"), "p/m", None, ["p", "m", 1, 2, 3]])
def test_a_resolution_that_is_not_a_five_tuple_is_host_incompatible(monkeypatch, result):
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "_resolve_task_provider_model", lambda *a, **k: result))
    with pytest.raises(host.HostIncompatible, match="5"):
        host.resolve_route("prompt_studio")


def test_a_redactor_without_the_force_flag_is_host_incompatible(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.redact", "redact_sensitive_text", lambda text: text))
    with pytest.raises(host.HostIncompatible, match="force"):
        host.redact_sensitive_text("secret")


def test_a_missing_hermes_is_unavailable_not_incompatible(monkeypatch):
    _hermes_absent(monkeypatch)
    for call in (lambda: host.call_llm(messages=[]), lambda: host.redact_sensitive_text("x"),
                 lambda: host.parse_reasoning_effort("low"), lambda: host.resolve_route("t")):
        with pytest.raises(host.HostUnavailable):
            call()


def test_an_import_that_crashes_is_host_incompatible(monkeypatch, tmp_path):
    package = tmp_path / "agent"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "redact.py").write_text("raise RuntimeError('changed under us')\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in ("agent", "agent.redact"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))  # registers the undo ...
        del sys.modules[name]  # ... and forces a fresh import from tmp_path
    with pytest.raises(host.HostIncompatible, match="agent.redact"):
        host.redact_sensitive_text("x")


# --- R4: no Hermes at all is not the same as an installed Hermes that fails to import -----------------------------
def test_installed_is_false_without_hermes_and_true_with_it(monkeypatch):
    _hermes_absent(monkeypatch)
    assert host.installed() is False
    _fake_hermes(monkeypatch)
    assert host.installed() is True


@pytest.mark.parametrize("module, call", [
    ("agent.auxiliary_client", lambda: host.resolve_route("t")),
    ("agent.redact", lambda: host.redact_sensitive_text("x")),
    ("hermes_constants", lambda: host.parse_reasoning_effort("low")),
])
def test_a_module_removed_from_an_installed_hermes_is_host_incompatible_not_unavailable(monkeypatch, module, call):
    _fake_hermes(monkeypatch)
    monkeypatch.setitem(sys.modules, module, None)  # agent / hermes_cli are still there: the module is gone
    with pytest.raises(host.HostIncompatible, match=module):
        call()


@pytest.mark.parametrize("module, capability", [
    ("agent.auxiliary_client", "auxiliary_client"),
    ("agent.redact", "redact"),
    ("hermes_constants", "reasoning_effort"),
    ("hermes_state", "session_store"),
    ("hermes_cli.web_server_sessions", "session_store"),
])
def test_verify_raises_host_incompatible_when_an_installed_hermes_lost_a_module(monkeypatch, module, capability):
    _fake_hermes(monkeypatch)
    monkeypatch.setitem(sys.modules, module, None)
    with pytest.raises(host.HostIncompatible, match=module):
        host.verify()


def test_a_dependency_missing_inside_an_installed_hermes_module_is_host_incompatible(monkeypatch, tmp_path):
    package = tmp_path / "agent"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "redact.py").write_text("import prompt_studio_test_dependency_that_does_not_exist\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in ("agent", "agent.redact"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
        del sys.modules[name]
    with pytest.raises(host.HostIncompatible, match="agent.redact"):
        host.redact_sensitive_text("x")


def test_a_nested_import_error_raised_by_an_installed_module_is_host_incompatible(monkeypatch, tmp_path):
    package = tmp_path / "agent"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "redact.py").write_text("from agent import nothing_here_either\n")  # ImportError, not ModuleNotFoundError
    monkeypatch.syspath_prepend(str(tmp_path))
    for name in ("agent", "agent.redact"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
        del sys.modules[name]
    with pytest.raises(host.HostIncompatible, match="agent.redact"):
        host.redact_sensitive_text("x")


def test_without_the_session_helper_module_an_installed_hermes_is_host_incompatible_not_a_fallback(monkeypatch):
    calls = _fake_hermes(monkeypatch)
    monkeypatch.setitem(sys.modules, "hermes_cli.web_server_sessions", None)
    with pytest.raises(host.HostIncompatible, match="web_server_sessions"):
        host.open_session_store("")
    assert calls["opened"] == []


# --- the session store ----------------------------------------------------------------------------------------------
def test_the_store_opens_read_only_through_the_core_helper(monkeypatch):
    calls = _fake_hermes(monkeypatch)
    store = host.open_session_store("work")
    assert calls["opened"] == [("work", True)]
    store.close()
    host.open_session_store("")
    assert calls["opened"][-1] == (None, True)


def test_without_the_core_helper_the_default_profile_opens_the_state_db_read_only(monkeypatch):
    calls = _fake_hermes(monkeypatch)
    for name in ("agent", "hermes_cli", "hermes_cli.web_server_sessions"):  # only hermes_state is importable
        monkeypatch.setitem(sys.modules, name, None)
    host.open_session_store("")
    host.open_session_store("default")
    assert calls["opened"] == [("SessionDB", True), ("SessionDB", True)]
    with pytest.raises(host.HostUnavailable):  # another profile has no fallback
        host.open_session_store("work")


def test_a_core_helper_that_lost_read_only_is_host_incompatible(monkeypatch):
    calls = _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile",
                                                  lambda profile: object()))
    with pytest.raises(host.HostIncompatible, match="read_only"):
        host.open_session_store("work")
    assert calls["opened"] == []


def test_a_renamed_core_helper_is_host_incompatible_not_a_silent_fallback(monkeypatch):
    calls = _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile", None))
    with pytest.raises(host.HostIncompatible, match="_open_session_db_for_profile"):
        host.open_session_store("")
    assert calls["opened"] == []


@pytest.mark.parametrize("missing", ["resolve_session_id", "get_messages", "close"])
def test_a_store_missing_a_method_the_reader_uses_is_host_incompatible_and_is_closed(monkeypatch, missing):
    closed = []

    class Broken:
        def resolve_session_id(self, session_id):
            return session_id

        def get_messages(self, session_id, limit=None, latest=False):
            return []

        def close(self):
            closed.append(1)

    delattr(Broken, missing)
    _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile",
                                          lambda profile, *, read_only: Broken()))
    with pytest.raises(host.HostIncompatible, match=missing):
        host.open_session_store("")
    assert bool(closed) == (missing != "close")


def test_a_store_whose_get_messages_lost_limit_or_latest_is_host_incompatible(monkeypatch):
    class Broken:
        def resolve_session_id(self, session_id):
            return session_id

        def get_messages(self, session_id):
            return []

        def close(self):
            pass

    _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile",
                                          lambda profile, *, read_only: Broken()))
    with pytest.raises(host.HostIncompatible, match="get_messages"):
        host.open_session_store("")


# --- verify(): the whole contract in one call --------------------------------------------------------------------
def test_verify_reports_every_capability_on_a_compatible_host(monkeypatch):
    _fake_hermes(monkeypatch)
    status = host.verify()
    assert status == {"auxiliary_client": "ok", "redact": "ok", "reasoning_effort": "ok", "session_store": "ok"}


def test_verify_without_hermes_reports_absent_and_does_not_raise(monkeypatch):
    _hermes_absent(monkeypatch)
    assert set(host.verify().values()) == {"absent"}


@pytest.mark.parametrize("override", [
    _override("agent.auxiliary_client", "call_llm", lambda *, messages: None),
    _override("agent.auxiliary_client", "_resolve_task_provider_model", lambda task: ("p", "m")),
    _override("agent.redact", "redact_sensitive_text", lambda text: text),
    _override("hermes_constants", "parse_reasoning_effort", lambda: None),
    _override("hermes_cli.web_server_sessions", "_open_session_db_for_profile", lambda profile: None),
])
def test_verify_raises_host_incompatible_for_each_changed_signature(monkeypatch, override):
    _fake_hermes(monkeypatch, **override)
    with pytest.raises(host.HostIncompatible):
        host.verify()


def test_verify_checks_the_session_store_class_without_opening_any_database(monkeypatch):
    calls = _fake_hermes(monkeypatch, **_override("hermes_state", "SessionDB", type("SessionDB", (), {
        "resolve_session_id": lambda self, s: s, "get_messages": lambda self, s: [], "close": lambda self: None})))
    with pytest.raises(host.HostIncompatible, match="get_messages"):
        host.verify()
    assert calls["opened"] == []


# --- the adapter and the readers use the module -------------------------------------------------------------------
def test_the_adapter_sends_only_keywords_the_module_declares(monkeypatch):
    captured = {}

    def call_llm(**kw):
        captured.update(kw)
        return {"choices": []}

    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", call_llm))
    adapter._default_llm(messages=[], max_tokens=10, timeout=5, is_json=True,
                         model_choice={"provider": "anthropic", "model": "m", "effort": "low"})
    assert set(captured) <= set(host.CALL_LLM_KWARGS) and {"provider", "model", "route_info"} <= set(captured)
    assert "temperature" not in captured and "top_p" not in captured


def test_a_changed_call_llm_surfaces_as_host_incompatible_from_the_adapter(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", lambda *, messages: None))
    with pytest.raises(host.HostIncompatible):
        adapter._default_llm(messages=[], max_tokens=10, timeout=5)
    assert adapter.provider_error_code(host.HostIncompatible("x")) == "host_incompatible"
    assert adapter.provider_error_code(RuntimeError("x")) == "unavailable"


def _engine():
    import importlib.util
    spec = importlib.util.spec_from_file_location("suggest_engine_host_test", DASHBOARD / "suggest_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_suggest_and_compose_answer_host_incompatible_when_hermes_changed(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", lambda *, messages: None))
    se = _engine()
    field = {"id": "a", "kind": "enum", "question": "Q?", "options": ["Yes", "No"]}
    out = se.suggest({"target": "opus", "intent": "Build a thing", "field": field})
    assert out["ok"] is False and out["code"] == "host_incompatible" and "model" in out
    out = se.compose({"target": "opus", "intent": "Build a thing", "answers": [], "baseline": "b"})
    assert out["ok"] is False and out["code"] == "host_incompatible"
    assert "route_info" not in json.dumps(out)  # the response never carries Hermes internals


# --- R5: SessionDB.close must be callable with no argument ----------------------------------------------------------
class _CloseNeedsAnArgument:
    def __init__(self, db_path=None, read_only=False):
        pass

    def resolve_session_id(self, session_id):
        return session_id

    def get_messages(self, session_id, limit=None, latest=False):
        return []

    def close(self, new_required):
        pass


def test_verify_raises_host_incompatible_when_the_store_class_close_needs_an_argument(monkeypatch):
    calls = _fake_hermes(monkeypatch, **_override("hermes_state", "SessionDB", _CloseNeedsAnArgument))
    with pytest.raises(host.HostIncompatible, match="close"):
        host.verify()
    assert calls["opened"] == []


def test_an_opened_store_whose_close_needs_an_argument_is_host_incompatible_before_it_is_used(monkeypatch):
    used = []

    class Broken(_CloseNeedsAnArgument):
        def get_messages(self, session_id, limit=None, latest=False):
            used.append(1)
            return []

    _fake_hermes(monkeypatch, **_override("hermes_cli.web_server_sessions", "_open_session_db_for_profile",
                                          lambda profile, *, read_only: Broken()))
    with pytest.raises(host.HostIncompatible, match="close"):
        host.open_session_store("")
    with pytest.raises(host.HostIncompatible, match="close"):
        host.check_session_store(Broken())
    assert used == []


# --- Codex round 1 -------------------------------------------------------------------------------------------------
def test_a_missing_response_extractor_is_host_incompatible_before_the_provider_is_called(monkeypatch):
    calls = []

    def call_llm(**kwargs):
        calls.append(kwargs)
        return {"choices": []}

    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", call_llm),
                 **_override("agent.auxiliary_client", "extract_content_or_reasoning", None))
    with pytest.raises(host.HostIncompatible):
        adapter._default_llm(messages=[], max_tokens=10, timeout=5)
    assert calls == []  # the contract: this code means no provider call was made


def test_a_changed_not_found_classifier_keeps_host_incompatible_after_a_provider_error(monkeypatch):
    def call_llm(**kwargs):
        raise RuntimeError("provider down")

    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "call_llm", call_llm),
                 **_override("agent.auxiliary_client", "_is_model_not_found_error", lambda: False))
    se = _engine()
    field = {"id": "a", "kind": "enum", "question": "Q?", "options": ["Yes", "No"]}
    out = se.suggest({"target": "opus", "intent": "Build a thing", "field": field})
    assert out["ok"] is False and out["code"] == "host_incompatible"
    assert out["error"] == adapter.HOST_INCOMPATIBLE_ERROR  # the fixed update-the-plugin sentence, not "host incompatible: RuntimeError"
    assert adapter.provider_error_code(RuntimeError("provider down")) == "host_incompatible"


def test_the_context_route_keeps_host_incompatible_when_the_not_found_classifier_changed(monkeypatch):
    _fake_hermes(monkeypatch, **_override("agent.auxiliary_client", "_is_model_not_found_error", lambda: False))
    import importlib.util
    spec = importlib.util.spec_from_file_location("session_context_host_test", DASHBOARD / "session_context.py")
    sc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sc)

    class Store:
        def resolve_session_id(self, sid):
            return sid

        def get_messages(self, sid, **kw):
            return [{"role": "user", "content": "hello there"}]

        def close(self):
            pass

    def llm(**_):
        raise RuntimeError("provider down")

    out = sc.context({"session_id": "s1", "profile": ""}, llm=llm, opener=lambda profile: Store())
    assert out["ok"] is False and out["code"] == "host_incompatible"
