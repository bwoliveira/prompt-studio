"""The repo .gitignore covers this project only: env files, caches, scratch space and stray images."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MUST_IGNORE = [
    ".env", ".env.local", "__pycache__/x.pyc", "dashboard/__pycache__/x.pyc", ".pytest_cache/x", ".ruff_cache/x", ".coverage", "htmlcov/index.html",
    "node_modules/a/index.js", ".scratch/notes.txt", "agent.log", ".DS_Store", ".vscode/settings.json", "file.swp",
]


@pytest.mark.parametrize("name", MUST_IGNORE)
def test_local_state_is_ignored(name):
    result = subprocess.run(["git", "check-ignore", "--no-index", "-q", name], cwd=REPO, check=False)
    assert result.returncode == 0, f"{name} is not ignored"


def test_env_example_is_not_ignored_and_no_tracked_file_is_ignored():
    assert subprocess.run(["git", "check-ignore", "--no-index", "-q", ".env.example"], cwd=REPO, check=False).returncode == 1
    tracked = subprocess.run(["git", "ls-files", "-ci", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True)
    assert tracked.stdout == ""


@pytest.mark.parametrize("name", ["tests/test_secrets.py", "dashboard/credentials_check.py", "desktop/src/secret-mask.js", "tests/desktop/credentials.test.mjs"])
def test_source_code_named_like_a_secret_is_not_ignored(name):
    # Source files may carry those words: no pattern hides them.
    result = subprocess.run(["git", "check-ignore", "--no-index", "-q", name], cwd=REPO, check=False)
    assert result.returncode == 1, f"{name} is ignored"


@pytest.mark.parametrize("name", ["docs/images/flow.png", "docs/images/settings.webp"])
def test_readme_images_under_docs_images_are_trackable(name):
    # Curated README images live in docs/images/; images elsewhere stay ignored.
    result = subprocess.run(["git", "check-ignore", "--no-index", "-q", name], cwd=REPO, check=False)
    assert result.returncode == 1, f"{name} is ignored"


@pytest.mark.parametrize("name", ["screenshot.png", "docs/shot.png", "tests/desktop/out.jpg", "screenshots/a.png"])
def test_other_images_stay_ignored(name):
    result = subprocess.run(["git", "check-ignore", "--no-index", "-q", name], cwd=REPO, check=False)
    assert result.returncode == 0, f"{name} is not ignored"

