"""CT-03 characterization tests for scripts/validate_install.parse_yaml_mapping."""
from __future__ import annotations

import importlib.util
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
