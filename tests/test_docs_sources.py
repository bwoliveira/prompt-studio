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
