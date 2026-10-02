"""Enforcement (#31): only dashboard/hermes_host.py imports Hermes; routes and engines go through it."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"

SIBLINGS = {"hermes_host", "llm_adapter", "suggest_engine", "session_context", "plugin_api"}
THIRD_PARTY_OK = {"fastapi", "pydantic"}


def _top_level_imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.lineno, node.module
        elif isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, "attr", getattr(func, "id", ""))
            if name in ("import_module", "__import__") and node.args and isinstance(node.args[0], ast.Constant) \
                    and isinstance(node.args[0].value, str) and not node.args[0].value.startswith("."):
                yield node.lineno, node.args[0].value


def test_only_the_host_module_imports_hermes():
    allowed = set(sys.stdlib_module_names) | THIRD_PARTY_OK | SIBLINGS
    offenders = []
    for path in sorted(DASHBOARD.glob("*.py")):
        if path.name == "hermes_host.py":
            continue
        for line, module in _top_level_imports(path):
            if module.split(".")[0] not in allowed:
                offenders.append(f"{path.name}:{line} imports {module}")
    assert not offenders, "Hermes symbols must come through hermes_host: " + "; ".join(offenders)


def test_the_scan_catches_a_hermes_import_and_a_dynamic_one(tmp_path):
    sample = tmp_path / "engine.py"
    sample.write_text("import json\nfrom agent.redact import x\nimport importlib\nimportlib.import_module('hermes_cli.config')\n"
                      "importlib.import_module(f'.{1}', __package__)\nfrom . import llm_adapter\n")
    assert sorted(module for _, module in _top_level_imports(sample)) == ["agent.redact", "hermes_cli.config", "importlib", "json"]
