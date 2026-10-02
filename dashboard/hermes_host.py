"""The one place where the backend touches Hermes.

Every Hermes-internal symbol the plugin uses (the auxiliary client, the redactor, the reasoning-effort parser, the
session store) is imported here, at call time, and its signature is checked right before the call. When a Hermes
update changed one of them, the call raises ``HostIncompatible`` (stable code ``host_incompatible``) with a message
naming the symbol, instead of a ``TypeError`` or a wrong answer somewhere deep in a request. When Hermes is not
installed at all (the top-level packages ``agent`` and ``hermes_cli`` are not importable: tests, a standalone checkout)
the call raises ``HostUnavailable``, an ``ImportError``: callers keep their offline fallbacks for that case only. A
module that fails to import while Hermes IS installed (moved, removed, a dependency gone, an ``ImportError`` inside it)
is a changed Hermes: ``HostIncompatible``.

Nothing imports Hermes at module load, so the module loads without it, and a test that swaps ``sys.modules`` entries
is picked up on the next call. ``tests/test_hermes_host_enforcement.py`` fails when any other file under ``dashboard/``
imports Hermes; ``tests/test_hermes_host_contract.py`` checks all of this against the installed Hermes.
"""
from __future__ import annotations

import importlib
import importlib.util
import inspect
import sys
from typing import Any

CODE = "host_incompatible"

_AUX = "agent.auxiliary_client"
_REDACT = "agent.redact"
_CONSTANTS = "hermes_constants"
_SESSIONS = "hermes_cli.web_server_sessions"
_STATE = "hermes_state"

# Keywords llm_adapter sends to ``call_llm`` (``provider`` and ``model`` only with a chosen model). No sampling
# parameter: Hermes decides them per model.
CALL_LLM_KWARGS = (
    "task", "messages", "max_tokens", "timeout", "route_info", "extra_body", "reasoning_config", "provider", "model",
)
RESOLUTION_LENGTH = 5  # (provider, model, base_url, api_key, api_mode)
# What the session reader calls on the store (resolve_resume_session_id is optional and checked when present).
_STORE_METHODS = ("resolve_session_id", "get_messages", "close")


class HostIncompatible(RuntimeError):
    """Hermes changed something the plugin relies on. ``code`` is the stable machine code of the routes."""

    code = CODE


class HostUnavailable(ImportError):
    """Hermes (or the part of it asked for) cannot be imported here."""


_ROOTS = ("agent", "hermes_cli")  # a Hermes install has at least one of these top-level packages


def _importable(top_level: str) -> bool:
    """The top-level module can be found (without importing it)."""
    if top_level in sys.modules:
        return sys.modules[top_level] is not None  # ``None`` is how a test (or an import hook) blocks a module
    try:
        return importlib.util.find_spec(top_level) is not None
    except Exception:  # noqa: BLE001 - a broken finder still means something is there
        return True


def installed(*extra_top_level: str) -> bool:
    """Hermes is installed here: ``agent`` or ``hermes_cli`` (or one of ``extra_top_level``) can be found."""
    return any(_importable(name) for name in (*_ROOTS, *extra_top_level))


def _module(name: str) -> Any:
    try:
        return importlib.import_module(name)
    except ImportError as exc:
        if not installed(name.partition(".")[0]):
            raise HostUnavailable(f"{name} is not importable: {exc}") from exc
        # Hermes is installed but this module (or something it imports) is not there: Hermes changed under us
        raise HostIncompatible(f"{name} failed to import ({type(exc).__name__}: {exc})") from exc
    except Exception as exc:  # the module is there but no longer loads: Hermes changed under us
        raise HostIncompatible(f"{name} failed to import ({type(exc).__name__})") from exc


def _symbol(module_name: str, attr: str) -> Any:
    value = getattr(_module(module_name), attr, None)
    if not callable(value):
        raise HostIncompatible(f"{module_name}.{attr} is missing")
    return value


def _check_call(fn: Any, label: str, *args: Any, **kwargs: Any) -> None:
    """``fn`` still accepts this call: same keywords, no new required argument."""
    try:
        signature = inspect.signature(fn)
    except (TypeError, ValueError):  # builtin or C callable: nothing to check against
        return
    try:
        signature.bind(*args, **kwargs)
    except TypeError as exc:
        raise HostIncompatible(f"{label}{signature} no longer takes this call: {exc}") from exc


# --- auxiliary client ------------------------------------------------------------------------------------------
def call_llm(**kwargs: Any) -> Any:
    fn = _symbol(_AUX, "call_llm")
    _check_call(fn, f"{_AUX}.call_llm", **kwargs)
    return fn(**kwargs)


def extract_content_or_reasoning(response: Any) -> Any:
    fn = _symbol(_AUX, "extract_content_or_reasoning")
    _check_call(fn, f"{_AUX}.extract_content_or_reasoning", response)
    return fn(response)


def check_extractor() -> None:
    """The response extractor is there and takes a response: asked before a provider call, which it must not follow."""
    _check_call(_symbol(_AUX, "extract_content_or_reasoning"), f"{_AUX}.extract_content_or_reasoning", None)


def auxiliary_task_config(task: str) -> dict[str, Any]:
    fn = _symbol(_AUX, "_get_auxiliary_task_config")
    _check_call(fn, f"{_AUX}._get_auxiliary_task_config", task)
    config = fn(task)
    if not isinstance(config, dict):
        raise HostIncompatible(f"{_AUX}._get_auxiliary_task_config no longer returns a dict")
    return config


def resolve_route(task: str) -> tuple:
    """``(provider, model, base_url, api_key, api_mode)`` of the task's route."""
    fn = _symbol(_AUX, "_resolve_task_provider_model")
    _check_call(fn, f"{_AUX}._resolve_task_provider_model", task)
    route = fn(task)
    if not isinstance(route, tuple) or len(route) != RESOLUTION_LENGTH:
        got = f"a tuple of {len(route)}" if isinstance(route, tuple) else type(route).__name__
        raise HostIncompatible(f"{_AUX}._resolve_task_provider_model no longer returns a tuple of {RESOLUTION_LENGTH} (got {got})")
    return route


def is_model_not_found_error(exc: BaseException) -> bool:
    fn = _symbol(_AUX, "_is_model_not_found_error")
    _check_call(fn, f"{_AUX}._is_model_not_found_error", exc)
    return bool(fn(exc))


def parse_reasoning_effort(effort: str) -> dict[str, Any] | None:
    fn = _symbol(_CONSTANTS, "parse_reasoning_effort")
    _check_call(fn, f"{_CONSTANTS}.parse_reasoning_effort", effort)
    return fn(effort)


# --- redactor --------------------------------------------------------------------------------------------------
def redact_sensitive_text(text: str) -> str:
    """Hermes' secret redactor, forced on (``force=True``) whatever the user's redaction setting."""
    fn = _symbol(_REDACT, "redact_sensitive_text")
    _check_call(fn, f"{_REDACT}.redact_sensitive_text", text, force=True)
    return fn(text, force=True)


# --- session store ---------------------------------------------------------------------------------------------
def _check_store_class(cls: Any) -> None:
    for name in _STORE_METHODS:
        if not callable(getattr(cls, name, None)):
            raise HostIncompatible(f"{_STATE}.SessionDB.{name} is missing")
    for name, args, kwargs in (("get_messages", ("session-id",), {"limit": 1, "latest": True}),
                               ("resolve_session_id", ("session-id",), {}), ("close", (), {})):
        _check_call(getattr(cls, name), f"{_STATE}.SessionDB.{name}", object(), *args, **kwargs)
    resume = getattr(cls, "resolve_resume_session_id", None)
    if resume is not None:
        _check_call(resume, f"{_STATE}.SessionDB.resolve_resume_session_id", object(), "session-id")


def check_session_store(store: Any) -> None:
    """``store`` (an opened session store) has the methods the reader calls, taking the arguments it passes."""
    for name in _STORE_METHODS:
        if not callable(getattr(store, name, None)):
            raise HostIncompatible(f"the session store no longer has {name}()")
    _check_call(store.get_messages, "session store get_messages", "session-id", limit=1, latest=True)
    _check_call(store.resolve_session_id, "session store resolve_session_id", "session-id")
    _check_call(store.close, "session store close")
    resume = getattr(store, "resolve_resume_session_id", None)
    if resume is not None:
        _check_call(resume, "session store resolve_resume_session_id", "session-id")


def open_session_store(profile: str) -> Any:
    """Read-only session store of ``profile``: the core sessions route's helper, else ``SessionDB`` (default profile)."""
    try:
        sessions = _module(_SESSIONS)
    except HostUnavailable:
        sessions = None
    if sessions is not None:
        opener = _symbol(_SESSIONS, "_open_session_db_for_profile")
        _check_call(opener, f"{_SESSIONS}._open_session_db_for_profile", profile or None, read_only=True)
        store = opener(profile or None, read_only=True)
    else:
        if profile and profile != "default":
            raise HostUnavailable("profile store helper unavailable")
        session_db = _symbol(_STATE, "SessionDB")
        _check_call(session_db, f"{_STATE}.SessionDB", read_only=True)
        store = session_db(read_only=True)
    try:
        check_session_store(store)
    except HostIncompatible:
        try:
            store.close()
        except Exception:  # noqa: BLE001 - the incompatibility is the error worth reporting
            pass
        raise
    return store


# --- the whole contract ----------------------------------------------------------------------------------------
def _verify_auxiliary(task: str) -> None:
    call = _symbol(_AUX, "call_llm")
    _check_call(call, f"{_AUX}.call_llm", **dict.fromkeys(CALL_LLM_KWARGS))
    check_extractor()
    _check_call(_symbol(_AUX, "_get_auxiliary_task_config"), f"{_AUX}._get_auxiliary_task_config", "task")
    _check_call(_symbol(_AUX, "_resolve_task_provider_model"), f"{_AUX}._resolve_task_provider_model", "task")
    _check_call(_symbol(_AUX, "_is_model_not_found_error"), f"{_AUX}._is_model_not_found_error", Exception())
    try:
        resolve_route(task)  # the shape of the answer: only a config read
    except HostIncompatible:
        raise
    except Exception:  # noqa: BLE001 - a config problem is not a changed Hermes
        pass


def _verify_redact(task: str) -> None:
    _check_call(_symbol(_REDACT, "redact_sensitive_text"), f"{_REDACT}.redact_sensitive_text", "text", force=True)


def _verify_reasoning_effort(task: str) -> None:
    _check_call(_symbol(_CONSTANTS, "parse_reasoning_effort"), f"{_CONSTANTS}.parse_reasoning_effort", "low")


def _verify_session_store(task: str) -> None:
    try:
        sessions = _module(_SESSIONS)
    except HostUnavailable:
        sessions = None
    if sessions is not None:
        opener = _symbol(_SESSIONS, "_open_session_db_for_profile")
        _check_call(opener, f"{_SESSIONS}._open_session_db_for_profile", "default", read_only=True)
    _check_store_class(_symbol(_STATE, "SessionDB"))


_CAPABILITIES = (
    ("auxiliary_client", _verify_auxiliary),
    ("redact", _verify_redact),
    ("reasoning_effort", _verify_reasoning_effort),
    ("session_store", _verify_session_store),
)


def verify(task: str = "prompt_studio") -> dict[str, str]:
    """Check every signature the plugin relies on, plus the shape of the task resolution (a config read).
    Never calls a provider and never opens a database.

    Returns ``{capability: "ok" | "absent"}`` (``absent``: Hermes is not installed here) and raises
    ``HostIncompatible`` for the first one that changed.
    """
    status: dict[str, str] = {}
    for name, check in _CAPABILITIES:
        try:
            check(task)
            status[name] = "ok"
        except HostUnavailable:
            status[name] = "absent"
    return status
