"""CT-03 characterization tests for scripts/validate_install.parse_yaml_mapping."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("validate_install_under_test", ROOT / "scripts" / "validate_install.py")
vi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vi)


def _parse(tmp_path, text):
    p = tmp_path / "plugin.yaml"
    p.write_text(text, encoding="utf-8")
    return vi.parse_yaml_mapping(p)


def test_parses_flat_subset(tmp_path):
    text = "# c\n\nname: x\n  # indented comment\nv: '1.0'\nd: \"q: r\"\nl: []\nm: {}\nk-1_: a: b\ne: ''\n"
    assert _parse(tmp_path, text) == {"name": "x", "v": "1.0", "d": "q: r", "l": [], "m": {}, "k-1_": "a: b", "e": ""}


@pytest.mark.parametrize("text,msg", [
    (" name: x\n", "invalid YAML at line 1"),
    ("a: 1\n\tb: 2\n", "invalid YAML at line 2"),
    ("novalue\n", "invalid YAML at line 1"),
    ("1a: x\n", "invalid YAML at line 1"),
    ("a:\n", "invalid YAML at line 1"),
    ("a: 'x\n", "invalid YAML at line 1"),
    ("a: '\n", "invalid YAML at line 1"),
    ("a: 'x\"\n", "invalid YAML at line 1"),
    ("a: [1]\n", "invalid YAML at line 1"),
    ("a: {b: 1}\n", "invalid YAML at line 1"),
    ("a: x]\n", "invalid YAML at line 1"),
    ("a: x}\n", "invalid YAML at line 1"),
    ("a: 1\na: 2\n", "duplicate manifest field 'a'"),
    ("a: 1\n\n# c\nb: [\n", "invalid YAML at line 4"),
])
def test_rejects_outside_subset(tmp_path, text, msg):
    with pytest.raises(vi.ValidationError, match=r"^" + __import__("re").escape(msg) + r"$"):
        _parse(tmp_path, text)


def test_unreadable_file(tmp_path):
    with pytest.raises(vi.ValidationError, match="cannot read plugin.yaml") as info:
        vi.parse_yaml_mapping(tmp_path / "missing.yaml")
    assert isinstance(info.value.__cause__, OSError)


SHELL_SCRIPT_CLI = pytest.mark.skipif(os.name == "nt", reason="the fake Hermes CLI is a shell script")


def _slow_hermes(tmp_path):
    # `exec` so the timeout kills the sleeping process itself and no child keeps the pipes open.
    fake = tmp_path / "hermes"
    fake.write_text("#!/bin/sh\nexec sleep 5\n", encoding="utf-8")
    fake.chmod(0o755)
    return fake


@SHELL_SCRIPT_CLI
def test_a_hermes_cli_that_does_not_answer_is_a_validation_error(tmp_path, monkeypatch):
    monkeypatch.setattr(vi, "VERSION_TIMEOUT_S", 0.3)
    with pytest.raises(vi.ValidationError, match=r"^Hermes CLI did not answer --version within 0\.3 s"):
        vi.host_version(str(_slow_hermes(tmp_path)))


@SHELL_SCRIPT_CLI
def test_a_slow_hermes_cli_ends_the_preflight_with_one_error_line_and_no_traceback(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(vi, "VERSION_TIMEOUT_S", 0.3)
    monkeypatch.setattr("sys.argv", ["validate_install.py", "--source", str(ROOT), "--hermes-bin", str(_slow_hermes(tmp_path))])
    assert vi.main() == 1
    out = capsys.readouterr()
    assert out.out == ""
    assert out.err.count("\n") == 1
    assert out.err.startswith("[ERROR] Hermes CLI did not answer --version within 0.3 s")
    assert "manifest" not in out.err and "Traceback" not in out.err


def test_the_preflight_waits_a_minute_for_the_hermes_version():
    # `hermes --version` took more than 40 s on a loaded machine; 15 s cut it off.
    assert vi.VERSION_TIMEOUT_S == 60
