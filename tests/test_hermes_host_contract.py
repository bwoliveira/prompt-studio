"""Contract of dashboard/hermes_host.py against the REAL Hermes install (#31).

Skipped when Hermes is not importable (CI, a laptop without Hermes). The signatures the plugin relies on are:
auxiliary ``call_llm`` keywords, the 5-tuple of ``_resolve_task_provider_model``, ``redact_sensitive_text(force=)``,
``parse_reasoning_effort``, the core session helper ``_open_session_db_for_profile(profile, read_only=)`` and the
``SessionDB`` methods the reader calls. A Hermes update that changes one fails here (and answers
``host_incompatible`` in the routes) instead of failing somewhere deep in a request.

Run it against the installed Hermes, un-skipped, with the interpreter Hermes itself runs on (the managed
environment under ``~/.hermes/installs``, Python 3.14 with fastapi, httpx and pyyaml). pytest is not installed there:
put one on the path from a scratch directory, nothing is written into the Hermes install or its environment:

    V=/root/.hermes/installs/<install id>/environments/<env id>/venv   # `hermes --print-runtime-command` shows the interpreter;
                                                                       # on this host: 76f6e7e5145b5f39 / fd9e2ae8fd5b4abfbcddd04902458aa6
    uv pip install --python $V/bin/python --target "$TMPDIR/pytest-site314" pytest
    PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/usr/local/lib/hermes-agent:$TMPDIR/pytest-site314 \\
        $V/bin/python -m pytest -p no:cacheprovider tests/test_hermes_host_contract.py

``PYTHONPATH`` must hold the Hermes checkout (the top-level modules sit beside ``agent``) and the pytest directory;
``PYTHONDONTWRITEBYTECODE`` keeps ``.pyc`` files out of the Hermes tree. Do not run it with the old
``/usr/local/lib/hermes-agent/venv`` interpreter: importing Hermes there can re-exec the process under the managed
runtime with ``-I``, which drops ``PYTHONPATH`` (and pytest with it). For the same reason the test writes no
messages into its throwaway store: ``SessionDB.append_message`` triggers that re-exec.
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import hermes_host as host  # noqa: E402

try:
    import agent.auxiliary_client  # noqa: F401
    import agent.redact  # noqa: F401
    import hermes_cli.web_server_sessions  # noqa: F401
    import hermes_constants  # noqa: F401
    import hermes_state
except Exception as exc:  # noqa: BLE001 - any failure to import means "no usable Hermes here"
    pytest.skip(f"Hermes is not importable here ({type(exc).__name__}: {exc})", allow_module_level=True)


def test_verify_passes_and_every_capability_is_present():
    assert host.verify() == {"auxiliary_client": "ok", "redact": "ok", "reasoning_effort": "ok", "session_store": "ok"}


def test_call_llm_takes_every_keyword_the_plugin_sends_and_no_sampling_parameter_is_needed():
    from agent.auxiliary_client import call_llm

    parameters = inspect.signature(call_llm).parameters
    for keyword in host.CALL_LLM_KWARGS:
        assert keyword in parameters, keyword
    required = [name for name, p in parameters.items() if p.default is p.empty and p.kind is not p.VAR_KEYWORD]
    assert set(required) <= set(host.CALL_LLM_KWARGS), required  # a new required argument would break every call


def test_the_task_resolution_is_a_five_tuple_for_the_prompt_studio_task():
    route = host.resolve_route("prompt_studio")
    assert isinstance(route, tuple) and len(route) == 5


def test_the_task_config_is_a_dict():
    assert isinstance(host.auxiliary_task_config("prompt_studio"), dict)


def test_the_redactor_masks_a_secret_with_force():
    secret = "sk-proj-" + "a1B2c3D4" * 4  # gitleaks:allow (fake key for the redaction test)
    assert secret not in host.redact_sensitive_text(f"my key is {secret} ok")


def test_the_model_not_found_check_accepts_an_exception():
    assert host.is_model_not_found_error(RuntimeError("boom")) in (True, False)


def test_reasoning_effort_parses_the_efforts_the_plugin_sends():
    assert host.parse_reasoning_effort("none") is None or isinstance(host.parse_reasoning_effort("none"), dict)
    for effort in ("minimal", "low", "medium", "high", "xhigh"):
        assert isinstance(host.parse_reasoning_effort(effort), dict), effort


def test_the_core_session_helper_takes_the_profile_and_read_only():
    from hermes_cli.web_server_sessions import _open_session_db_for_profile

    inspect.signature(_open_session_db_for_profile).bind("default", read_only=True)


def test_session_store_reads_a_real_database_through_the_reader(tmp_path):
    """A throwaway SessionDB in tmp_path (never the user's state.db), read back through the plugin's reader."""
    import importlib.util

    db_path = tmp_path / "state.db"
    writer = hermes_state.SessionDB(db_path=db_path)
    writer.create_session("sess-1", "cli")  # no messages: append_message re-execs Hermes (see the module docstring)
    writer.close()

    def opener(profile):
        return hermes_state.SessionDB(db_path=db_path, read_only=True)

    store = opener("")
    host.check_session_store(store)  # the methods the reader calls, with the arguments it passes
    assert store.resolve_session_id("sess-1") == "sess-1"
    assert store.resolve_resume_session_id("sess-1")
    assert store.get_messages("sess-1", limit=200, latest=True) == []
    store.close()

    spec = importlib.util.spec_from_file_location("session_context_contract", Path(host.__file__).with_name("session_context.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.read_session("sess-1", opener=opener) == ([], "")
    assert module.read_session("no-such-session", opener=opener) is None


def test_the_adapter_runs_against_the_real_resolution_without_calling_a_provider(monkeypatch):
    """_default_llm up to the provider call: real config resolution and effort parsing, a stub for call_llm only."""
    import llm_adapter

    seen = {}

    def stop(**kwargs):
        seen.update(kwargs)
        return {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}

    import agent.auxiliary_client as aux

    monkeypatch.setattr(aux, "call_llm", stop)
    llm_adapter._default_llm(messages=[{"role": "user", "content": "x"}], max_tokens=16, timeout=5.0, is_json=True)
    assert seen["task"] == "prompt_studio" and set(seen) <= set(host.CALL_LLM_KWARGS)
    assert "temperature" not in seen and "top_p" not in seen
