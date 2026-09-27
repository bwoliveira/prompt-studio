"""scripts/docs_sources.py must not depend on a machine-specific path (C10)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("docs_sources_under_test", ROOT / "scripts" / "docs_sources.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_no_absolute_machine_paths_in_the_script():
    assert "/root/" not in (ROOT / "scripts" / "docs_sources.py").read_text(encoding="utf-8")


def test_docs_dir_defaults_repo_relative_and_env_or_arg_override(monkeypatch, tmp_path):
    monkeypatch.delenv("PROMPT_DOCS_DIR", raising=False)
    mod = _load()
    default = mod.snapshots_dir()
    assert not default.is_absolute() or ROOT.parent in default.parents or default.parent == ROOT.parent
    monkeypatch.setenv("PROMPT_DOCS_DIR", str(tmp_path))
    assert mod.snapshots_dir() == tmp_path
    assert mod.snapshots_dir(str(tmp_path / "x")) == tmp_path / "x"


# --- CT-07: fetch / diff / _norm / check against a fake manifest, review and snapshot dir (no network).
import hashlib
import json

import pytest


def _fake(monkeypatch, tmp_path, docs=None, review=""):
    mod = _load()
    manifest = tmp_path / "MANIFEST.json"
    docs = docs or {"anthropic": {"a-doc": {"url": "https://x/a.md", "sha256": ""}}, "openai": {"o-doc": {"url": "https://x/o.md", "sha256": ""}}}
    manifest.write_text(json.dumps({"docs": docs}), encoding="utf-8")
    review_path = tmp_path / "REVIEW.md"
    review_path.write_text(review, encoding="utf-8")
    snaps = tmp_path / "snaps"
    monkeypatch.setattr(mod, "MANIFEST", manifest)
    monkeypatch.setattr(mod, "REVIEW", review_path)
    monkeypatch.setattr(mod, "SNAPSHOTS", snaps)
    return mod, manifest, snaps


def _write(snaps, vendor, doc_id, text):
    (snaps / vendor).mkdir(parents=True, exist_ok=True)
    (snaps / vendor / f"{doc_id}.md").write_text(text, encoding="utf-8")


def test_fetch_writes_snapshots_and_records_sha_in_the_manifest(monkeypatch, tmp_path):
    mod, manifest, snaps = _fake(monkeypatch, tmp_path)
    monkeypatch.setattr(mod, "_get", lambda url: f"body of {url}")
    assert mod.fetch() == 0
    assert (snaps / "anthropic" / "a-doc.md").read_text(encoding="utf-8") == "body of https://x/a.md"
    meta = json.loads(manifest.read_text(encoding="utf-8"))["docs"]["openai"]["o-doc"]
    assert meta["sha256"] == hashlib.sha256(b"body of https://x/o.md").hexdigest()
    assert meta["chars"] == len("body of https://x/o.md") and meta["fetched"]


def test_fetch_keeps_previous_snapshot_and_fails_when_a_download_errors(monkeypatch, tmp_path, capsys):
    mod, _, snaps = _fake(monkeypatch, tmp_path)
    _write(snaps, "openai", "o-doc", "old")

    def get(url):
        if url.endswith("o.md"):
            raise OSError("boom")
        return "new"

    monkeypatch.setattr(mod, "_get", get)
    assert mod.fetch() == 1
    assert (snaps / "openai" / "o-doc.md").read_text(encoding="utf-8") == "old"
    assert "FAIL openai/o-doc: boom" in capsys.readouterr().out


def test_diff_reports_no_change_when_hashes_match(monkeypatch, tmp_path, capsys):
    sha = hashlib.sha256(b"same").hexdigest()
    docs = {"anthropic": {"a-doc": {"url": "u", "sha256": sha}}}
    mod, _, _ = _fake(monkeypatch, tmp_path, docs=docs)
    monkeypatch.setattr(mod, "_get", lambda url: "same")
    assert mod.diff() == 0
    out = capsys.readouterr().out
    assert "CHANGED" not in out and "0 doc(s) changed" in out


def test_diff_reports_sha_mismatch_and_download_failures(monkeypatch, tmp_path, capsys):
    docs = {"anthropic": {"a-doc": {"url": "https://x/a.md", "sha256": "stale"}, "b-doc": {"url": "bad", "sha256": "x"}}}
    mod, _, _ = _fake(monkeypatch, tmp_path, docs=docs)

    def get(url):
        if url == "bad":
            raise OSError("offline")
        return "changed"

    monkeypatch.setattr(mod, "_get", get)
    assert mod.diff() == 0  # diff is informational: it reports, it does not fail
    out = capsys.readouterr().out
    assert "CHANGED anthropic/a-doc  https://x/a.md" in out
    assert "FAIL anthropic/b-doc: offline" in out and "1 doc(s) changed" in out


def test_norm_strips_markdown_escapes_and_smart_quotes_and_collapses_whitespace():
    mod = _load()
    assert mod._norm("  Use \\*bold\\* `code`\n\n and \u201cquotes\u201d it\u2019s  ") == 'use bold code and "quotes" it\'s'


def test_check_passes_when_every_quote_is_verbatim(monkeypatch, tmp_path, capsys):
    review = (
        '| rule | *"Be clear and direct."* [a-doc] |\n'
        '| rule | *"Use XML tags … structure"* [o-doc] [a-doc] |\n'
        '| no ref here | *"ignored quote"* |\n'
    )
    mod, _, snaps = _fake(monkeypatch, tmp_path, review=review)
    _write(snaps, "anthropic", "a-doc", "Intro. **Be clear\n  and direct.** Then use XML tags to give structure.")
    _write(snaps, "openai", "o-doc", "unrelated")
    assert mod.check() == 0
    assert "2/2 quotes found verbatim" in capsys.readouterr().out


def test_check_fails_on_a_missing_quote_or_missing_snapshot(monkeypatch, tmp_path, capsys):
    review = '| a | *"Be clear and direct."* [a-doc] |\n| b | *"Not in the doc."* [a-doc] |\n| c | *"anything"* [o-doc] |\n'
    mod, _, snaps = _fake(monkeypatch, tmp_path, review=review)
    _write(snaps, "anthropic", "a-doc", "Be clear and direct.")  # o-doc snapshot absent
    assert mod.check() == 1
    out = capsys.readouterr().out
    assert "NOT FOUND line 2 [a-doc]: Not in the doc." in out
    assert "NOT FOUND line 3 [o-doc]" in out and "1/3 quotes found verbatim" in out
