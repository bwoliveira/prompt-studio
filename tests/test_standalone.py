"""Prompt Studio is a standalone project: the old project's names live only in the credits."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


BANNED = re.compile(r"grill|growtab|bluetab|thanhan", re.IGNORECASE)


def _allowed_lines(path: str, text: str) -> set[int]:
    lines = text.splitlines()
    allowed: set[int] = set()
    if path == "README.md":
        inside = False
        for i, line in enumerate(lines):
            if line.startswith("## "):
                inside = line.strip() == "## Credits"
            if inside:
                allowed.add(i)
    elif path == "LICENSE":
        for i, line in enumerate(lines):
            if line.startswith("Portions of this software are derived from grill-tab") or (
                i and lines[i - 1].startswith("Portions of this software are derived from grill-tab")
            ):
                allowed.add(i)
    return allowed


def test_old_project_is_named_only_in_credits():
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    hits = []
    for path in files:
        if path == "tests/test_standalone.py":
            continue
        try:
            text = (ROOT / path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        allowed = _allowed_lines(path, text)
        for i, line in enumerate(text.splitlines()):
            if BANNED.search(line) and i not in allowed:
                hits.append(f"{path}:{i + 1}: {line.strip()[:120]}")
    assert not hits, "\n".join(hits)


def test_adapter_reads_only_prompt_studio():
    source = (ROOT / "dashboard" / "llm_adapter.py").read_text(encoding="utf-8")
    assert '_AUX_TASK = "prompt_studio"' in source
    assert "_LEGACY_AUX_TASKS" not in source and "_aux_task_key" not in source
