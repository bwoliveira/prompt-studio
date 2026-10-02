"""Packaging invariants for Prompt Studio v1: names, versions, homepage, aux task, desktop hygiene."""
from __future__ import annotations

import json
import re
import types
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")


def _plugin():
    return yaml.safe_load((ROOT / "plugin.yaml").read_text(encoding="utf-8"))


def _dashboard():
    return json.loads((ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8"))


def test_versions_match_and_are_semver():
    assert SEMVER.match(str(_plugin()["version"]))
    assert str(_plugin()["version"]) == _dashboard()["version"]


def test_names_are_prompt_studio():
    assert _plugin()["name"] == "prompt-studio"
    assert _dashboard()["name"] == "prompt-studio"


def test_homepage_author_and_description():
    plugin = _plugin()
    assert plugin["homepage"] == "https://github.com/bwoliveira/prompt-studio"
    assert plugin["author"] == "bwoliveira"


def test_license_names_the_author_and_keeps_the_portions_notice():
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert "Copyright (c) 2026 Bruno Oliveira" in text
    assert "Portions of this software are derived from" in text and "MIT License" in text


def test_registers_the_prompt_studio_auxiliary_task():
    import importlib.util
    spec = importlib.util.spec_from_file_location("prompt_studio_init_under_test", ROOT / "__init__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []
    ctx = types.SimpleNamespace(register_auxiliary_task=lambda name, **kw: calls.append((name, kw)))
    module.register(ctx)
    assert [c[0] for c in calls] == ["prompt_studio"]
    assert calls[0][1]["display_name"] == "Prompt Studio"
    # Same default timeout as install.sh and the README (20 s, the step limit).
    assert calls[0][1]["defaults"] == {"timeout": 20}
    assert "auxiliary.prompt_studio.timeout 20 " in (ROOT / "install.sh").read_text(encoding="utf-8")
    assert "    timeout: 20\n" in (ROOT / "README.md").read_text(encoding="utf-8")
    assert "      timeout: 20\n" in (ROOT / "docs" / "CONFIGURATION.md").read_text(encoding="utf-8")


def test_register_needs_the_declared_minimum_hermes_and_has_no_older_host_branch():
    import importlib.util
    spec = importlib.util.spec_from_file_location("prompt_studio_init_min_under_test", ROOT / "__init__.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # requires_hermes is >=0.21.5, whose plugin context always has register_auxiliary_task: a host without it
    # is not supported, so register() calls it directly instead of skipping the picker entry.
    assert re.search(r'requires_hermes:\s*"?>=\s*0\.2[1-9]', (ROOT / "plugin.yaml").read_text(encoding="utf-8"))
    with pytest.raises(AttributeError):
        module.register(types.SimpleNamespace())
    assert "Hermes < 0.20" not in (ROOT / "__init__.py").read_text(encoding="utf-8")


def test_desktop_plugin_uses_only_ctx_tracked_listeners_and_storage():
    source = (ROOT / "desktop" / "plugin.js").read_text(encoding="utf-8")
    banned = ["window.addEventListener(", "document.addEventListener(", "localStorage", "sessionStorage"]
    hits = [b for b in banned if b in source]
    assert not hits, f"desktop/plugin.js still uses {hits}"
