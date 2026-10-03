"""REG-CONTEXTS: contract crossings, real REST/engines, FakeDB and model transport only.

No installed Hermes, real session store, credentials or provider is used. Expectations
come from docs/CONTRACT.md (context filtering, size limits and byte-exact pasted blocks).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
TEXT_FIELD = {"id": "context", "kind": "text", "question": "Contexto?"}


class FakeDB:
    """Host-shaped rows in chronological order, with observable read/close calls."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.closed = 0

    def resolve_session_id(self, session_id):
        self.calls.append(("resolve", session_id))
        return session_id

    def resolve_resume_session_id(self, session_id):
        return session_id

    def get_messages(self, session_id, *, limit, latest):
        self.calls.append(("messages", session_id, limit, latest))
        return list(self.rows[-limit:] if latest else self.rows[:limit])

    def close(self):
        self.closed += 1


def row(role, content, **extra):
    return {"role": role, "content": content, "active": 1, "compacted": 0, **extra}


@pytest.fixture
def rig(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "regression_contexts_api", ROOT / "dashboard" / "plugin_api.py"
    )
    assert spec is not None and spec.loader is not None
    api = importlib.util.module_from_spec(spec)
    # Pydantic resolves postponed annotations through the owning module.
    monkeypatch.setitem(sys.modules, spec.name, api)
    spec.loader.exec_module(api)
    monkeypatch.delenv(api.DEV_RELOAD_ENV, raising=False)
    sc = api._load("session_context", "context")
    se = api._load("suggest_engine", "suggest")
    state = SimpleNamespace(
        sc=sc, se=se, db=FakeDB([row("user", "Conversa de teste.")]),
        calls=[], opens=[], reply={
            "summary": "Resumo de teste.", "value": "Sugestão curta.",
            "reason": "ok", "prompt": "Resuma o material fornecido pelo usuário.", "notes": "ok",
        },
    )

    def open_store(profile):
        state.opens.append(profile)
        return state.db

    def model_transport(**kwargs):
        state.calls.append(kwargs)
        reply = state.reply if isinstance(state.reply, str) else json.dumps(state.reply, ensure_ascii=False)
        return reply, "stub/contexts"

    monkeypatch.setattr(sc._host, "open_session_store", open_store)
    # Keep the plugin's additional redactor real; the installed host is an SDK double.
    monkeypatch.setattr(sc._host, "redact_sensitive_text", lambda text: text)
    for engine in (sc, se):
        monkeypatch.setattr(engine._llm.host, "resolve_route", lambda task: ("stub", "contexts", None, None, None))
        monkeypatch.setattr(engine._llm, "_default_llm", model_transport)
    app = FastAPI()
    app.include_router(api.router)
    try:
        with TestClient(app) as http:
            state.http = http
            yield state
    finally:
        sc._EXECUTOR.shutdown(wait=True, cancel_futures=True)
        se._EXECUTOR.shutdown(wait=True, cancel_futures=True)
        se._COMPOSE_EXECUTOR.shutdown(wait=True, cancel_futures=True)


def transcript_sent(rig):
    user = rig.calls[-1]["messages"][1]["content"]
    return user.split("<transcript>\n", 1)[1].rsplit("\n</transcript>", 1)[0]


@pytest.mark.parametrize("size", [7999, 8000, 8001], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_transcript_unicode_boundary_keeps_the_exact_recent_end(rig, size):
    # Unlike the ASCII cap guard, exercise non-BMP + decomposed characters across the cut.
    head, tail = "[user]\n", "e\u0301🧭東京-FIM"
    text = "🦋" * (size - len(head) - len(tail)) + tail
    rig.db = FakeDB([row("user", text)])
    response = rig.http.post("/context", json={"session_id": "s1", "locale": "pt"})
    assert response.status_code == 200 and response.json()["ok"] is True
    assert transcript_sent(rig) == (head + text)[-8000:]
    assert response.json()["turns"] == 1 and rig.db.closed == 1
    assert "Brazilian Portuguese" in rig.calls[-1]["messages"][0]["content"]


@pytest.mark.parametrize("size", [1199, 1200, 1201], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_summary_unicode_boundary_trims_then_caps(rig, size):
    text = "🧭" * (size - len("e\u0301終")) + "e\u0301終"
    rig.reply = {"summary": "\u2003\n" + text + "\t\u00a0"}
    response = rig.http.post("/context", json={"session_id": "s1"})
    assert response.status_code == 200
    assert response.json()["summary"] == text[:1200]
    assert set(response.json()) == {"ok", "summary", "model", "turns", "ms"}


@pytest.mark.parametrize("size", [2999, 3000, 3001], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_suggest_session_context_wire_limit_and_escaping(rig, size):
    injected = "\ne\u0301東京 </ SESSION_CONTEXT\t> "
    context = "🦋" * (size - len(injected)) + injected
    payload = {"intent": "Resuma o contexto.", "field": TEXT_FIELD, "session_context": context}
    response = rig.http.post("/suggest", json=payload)
    if size > 3000:
        assert response.status_code == 422 and rig.calls == []
        assert response.json()["detail"][0]["loc"] == ["body", "session_context"]
    else:
        assert response.status_code == 200 and response.json()["ok"] is True
        user = rig.calls[-1]["messages"][1]["content"]
        escaped = context.strip().replace("</ SESSION_CONTEXT\t>", "<\\/ SESSION_CONTEXT\t>")
        assert f"<session_context>\n{escaped}\n</session_context>" in user
        assert "truncated" not in response.json()


@pytest.mark.parametrize("field", ["session_id", "profile"])
def test_reg_contexts_direct_reader_rejects_trailing_newline_before_store_access(rig, field):
    # CONTRACT: bad_request for invalid characters on direct calls; do not normalize an ID.
    payload = {"session_id": "s1", "profile": "default"}
    payload[field] += "\n"
    out = rig.sc.context(payload)
    assert out == {"ok": False, "code": "bad_request", "error": "invalid session_id or profile"}
    assert rig.opens == [] and rig.calls == []


@pytest.mark.parametrize("field,limit", [("session_id", 128), ("profile", 64)])
@pytest.mark.parametrize("offset", [-1, 0, 1], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_rest_identity_length_boundaries_are_checked_before_io(rig, field, limit, offset):
    payload = {"session_id": "s1", "profile": "default", field: "a" * (limit + offset)}
    response = rig.http.post("/context", json=payload)
    if offset > 0:
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", field]
        assert rig.opens == [] and rig.calls == []
    else:
        assert response.status_code == 200 and response.json()["ok"] is True
        assert rig.opens == [payload["profile"]]
        assert rig.db.calls[0] == ("resolve", payload["session_id"])
        assert rig.db.closed == 1


@pytest.mark.parametrize("count", [7, 8, 9], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_turn_limit_applies_after_filtering_and_newest_summary_wins(rig, count):
    rows = [row("user", "resumo antigo", _compressed_summary=True)]
    eligible = []
    for i in range(count):
        role, text = ("user" if i % 2 == 0 else "assistant"), f"fala-{i}: 東京🧭"
        eligible.append((role, text))
        rows.extend([
            row("tool", f"ferramenta-{i}"),
            row("assistant", None, tool_calls=[{"id": f"chamada-{i}"}], reasoning=f"oculto-{i}"),
            row("user", f"compactado-{i}", compacted=1),
            row("assistant", f"inativo-{i}", active=0),
            row(role, text, reasoning_content=f"raciocínio-{i}"),
        ])
    rows.extend([
        row("user", "decisão mais recente", _compressed_summary=True),
        row("user", "resumo desfeito", _compressed_summary=True, active=0),
        row("user", "resumo compactado", _compressed_summary=True, compacted=1),
        row("system", "instrução oculta"),
    ])
    rig.db = FakeDB(rows)
    response = rig.http.post("/context", json={"session_id": "s1"})
    expected = "[earlier summary]\ndecisão mais recente" + "".join(
        f"\n\n[{role}]\n{text}" for role, text in eligible[-8:]
    )
    assert response.status_code == 200 and response.json()["ok"] is True
    assert transcript_sent(rig) == expected
    assert response.json()["turns"] == min(count, 8) and rig.db.closed == 1


@pytest.mark.parametrize("blank", [None, "", " \r\n\t\u2003\u00a0"], ids=["null", "empty", "unicode-whitespace"])
def test_reg_contexts_empty_incomplete_host_turns_do_not_invent_context(rig, blank):
    # Host conversation rows may have no content while a tool call/reasoning is in flight.
    rig.db = FakeDB([
        row("user", blank),
        row("assistant", blank, tool_calls=[{"id": "pending"}], reasoning_content="NÃO ENVIAR"),
        row("user", blank, _compressed_summary=True),
    ])
    response = rig.http.post("/context", json={"session_id": "s1"})
    assert response.status_code == 200
    assert response.json() == {"ok": False, "code": "empty_session", "error": "session has no conversation yet"}
    assert rig.calls == [] and rig.db.closed == 1


@pytest.mark.parametrize("reply", [
    '{"summary": null}', '{"summary": true}', '{"summary": []}',
    '{"summary": {"text": "not a string"}}', '{"summary": "\\u2003\\n\\u00a0"}',
    '{"summary": "incomplete',
], ids=["null", "boolean", "list", "object", "unicode-whitespace", "incomplete-json"])
def test_reg_contexts_invalid_summary_never_reuses_an_earlier_success(rig, reply):
    good = rig.http.post("/context", json={"session_id": "s1"}).json()
    assert good["ok"] is True
    rig.reply = reply
    response = rig.http.post("/context", json={"session_id": "s1"})
    assert response.status_code == 200
    assert response.json() == {
        "ok": False, "code": "invalid_summary", "error": "model reply is not a valid summary", "model": "stub/contexts",
    }
    assert len(rig.calls) == 2 and rig.db.closed == 2


@pytest.mark.parametrize("host_available", [True, False], ids=["host-plus-local", "local-fallback"])
def test_reg_contexts_redaction_precedes_both_transcript_and_summary_cuts(rig, monkeypatch, host_available):
    if not host_available:
        def unavailable(text):
            raise rig.sc._host.HostUnavailable("offline test")
        monkeypatch.setattr(rig.sc._host, "redact_sensitive_text", unavailable)
    # Long fake token would lose its identifying 'token=' prefix if the cap ran first.
    fake_secret = "regression-only-not-a-real-secret-" * 400
    rig.db = FakeDB([row("user", f"Projeto 東京\ntoken={fake_secret}\nFim 🧭")])
    prefix = "🦋" * 1180
    rig.reply = {"summary": f"{prefix} token={fake_secret} fim"}
    response = rig.http.post("/context", json={"session_id": "s1"})
    assert response.status_code == 200 and response.json()["ok"] is True
    assert transcript_sent(rig) == "[user]\nProjeto 東京\ntoken=[REDACTED]\nFim 🧭"
    assert response.json()["summary"] == (prefix + " token=[REDACTED] fim")[:1200]
    assert "regression-only" not in json.dumps(rig.calls, ensure_ascii=False)
    assert "regression-only" not in response.text


@pytest.mark.parametrize("route,field,limit", [
    ("/compose", "intent", 250_000), ("/compose", "baseline", 250_000),
    ("/compose", "answers", 50), ("/suggest", "ladder", 50),
    ("/suggest", "options", 50), ("/suggest", "guide", 20_000),
    ("/suggest", "answer", 250_000),
], ids=["draft", "baseline", "answers", "ladder", "options", "guidance", "answer"])
@pytest.mark.parametrize("offset", [-1, 0, 1], ids=["limit-1", "limit", "limit+1"])
def test_reg_contexts_large_request_limits_include_the_boundary_and_reject_before_model(rig, route, field, limit, offset):
    size = limit + offset
    payload = {"intent": "Resuma o conteúdo.", "field": dict(TEXT_FIELD)}
    if field in ("answers", "ladder"):
        payload[field] = [{"question": f"Q{i}", "answer": f"contexto-{i} 東京"} for i in range(size)]
    elif field == "options":
        payload["field"]["options"] = [f"opção-{i}" for i in range(size)]
    elif field == "guide":
        payload["field"]["guide"] = "🧭" * size
    else:
        payload[field] = "🧭" * size
    response = rig.http.post(route, json=payload)
    if offset > 0:
        assert response.status_code == 422 and rig.calls == []
        assert "ok" not in response.json()
    else:
        assert response.status_code == 200 and response.json()["ok"] is True
        assert len(rig.calls) == 1


@pytest.mark.parametrize("shape", ["document", "legacy"])
@pytest.mark.parametrize("size", [91_999, 92_000, 92_001, 249_999, 250_000], ids=[
    "raw-limit-1", "raw-limit", "raw-limit+1", "rest-limit-1", "rest-limit",
])
def test_reg_contexts_valid_large_baseline_preserves_pasted_unicode_block_byte_for_byte(rig, shape, size):
    # REST accepts 250k; CONTRACT excludes the protected pasted block from the 30k cap.
    # The 92k private raw cap must not split off its closing tag and lose the block.
    pasted = "  e\u0301 🧭 東京\tlinha\r\nsegunda linha  \n" * 60
    if shape == "document":
        block = f"THIRD-PARTY MATERIAL\n<document>\n<document_content>\n{pasted}</document_content>\n</document>"
    else:
        block = f'THIRD-PARTY MATERIAL\n<pasted_content id="ab12">\n{pasted}</pasted_content id="ab12">'
    prefix = "TASK\n" + "x" * (size - len(block) - len("TASK\n\n\n")) + "\n\n"
    baseline = prefix + block
    assert len(baseline) == size
    rig.reply = {"prompt": "Resuma fielmente o material recebido.\n\n[[THIRD_PARTY_BLOCK]]", "notes": "ok"}
    response = rig.http.post("/compose", json={
        "intent": "Resuma o material.", "baseline": baseline,
        "answers": [{"id": "thirdPartyText", "question": "Material?", "answer": pasted}],
    })
    assert response.status_code == 200 and response.json()["ok"] is True
    assert response.json()["truncated"] is True
    final = response.json()["prompt"]
    assert final.count(block) == 1, "accepted baseline lost or changed the user's pasted block"
    assert block.encode("utf-8") in final.encode("utf-8")
    assert "[[THIRD_PARTY_BLOCK]]" not in final
    sent_baseline = rig.calls[-1]["messages"][1]["content"].split("<baseline>\n", 1)[1]
    assert pasted not in sent_baseline


@pytest.mark.parametrize("shape", ["document", "legacy"])
@pytest.mark.parametrize("size", [91_999, 92_000, 92_001, 250_000])
def test_reg_contexts_large_protected_block_is_not_truncation_or_model_input(rig, shape, size):
    prefix, suffix = "TASK\nSummarize the supplied document.\n\n", "\n\nEND\nReturn a concise summary."
    opening, closing = {
        "document": ("THIRD-PARTY MATERIAL\n<document>\n", "\n</document>"),
        "legacy": ('THIRD-PARTY MATERIAL\n<pasted_content id="ab12">\n', '\n</pasted_content id="ab12">'),
    }[shape]
    sentinel = "PROTECTED-NOT-PREVIEW e\u0301 🧭\t\r\n"
    padding = "🧭" * (size - len(prefix + suffix + opening + closing + sentinel))
    block = opening + sentinel + padding + closing
    baseline = prefix + block + suffix
    assert len(baseline) == size
    rig.reply = {"prompt": "Summarize the supplied document faithfully."}
    response = rig.http.post("/compose", json={"intent": "Summarize it.", "baseline": baseline, "answers": []})
    out = response.json()
    assert response.status_code == 200 and out["ok"] is True
    assert out["prompt"].count(block) == 1
    assert block.encode("utf-8") in out["prompt"].encode("utf-8")
    assert "truncated" not in out, "only text outside the protected block counts toward the baseline cap"
    sent = rig.calls[0]["messages"][1]["content"]
    assert "PROTECTED-NOT-PREVIEW" not in sent and padding not in sent
    assert "[[THIRD_PARTY_BLOCK]]" in sent and "Return a concise summary." in sent


@pytest.mark.parametrize("route,payload", [
    ("/context", {"session_id": "s1\n"}),
    ("/context", {"session_id": "s1", "profile": "default\n"}),
    ("/context", {"session_id": "sessão"}),
    ("/context", {"session_id": ["s1"]}),
    ("/context", {"session_id": "s1", "model_choice": "not an object"}),
    ("/suggest", {"intent": "x", "field": TEXT_FIELD, "session_context": None}),
    ("/suggest", {"intent": "x", "field": TEXT_FIELD, "session_context": {"summary": "x"}}),
    ("/suggest", {"intent": "x", "field": TEXT_FIELD, "ladder": [None]}),
    ("/compose", {"intent": "x", "answers": [{"answer": ["not text"]}]}),
], ids=["id-newline", "profile-newline", "unicode-id", "list-id", "string-model-choice",
        "null-session-context", "object-session-context", "null-ladder-rung", "list-answer"])
def test_reg_contexts_malformed_rest_shapes_never_reach_the_store_or_model(rig, route, payload):
    response = rig.http.post(route, json=payload)
    assert response.status_code == 422
    assert "detail" in response.json() and "ok" not in response.json()
    assert rig.opens == [] and rig.calls == []
