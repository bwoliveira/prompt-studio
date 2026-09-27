"""The repo .gitignore keeps common secret and dump files out of git (GI-1)."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MUST_IGNORE = [
    "prod.env", ".envrc", "service-account.json", "gcp-key.json", "token.txt", "api_key.txt", "apikey",
    "id_ecdsa", "id_dsa", ".docker/config.json", "kubeconfig", "vault.kdbx", "cookies.txt", "dump.sql", "notes.bak",
    ".env", ".env.local", "id_rsa", "server.pem",
]


@pytest.mark.parametrize("name", MUST_IGNORE)
def test_secret_names_are_ignored(name):
    result = subprocess.run(["git", "check-ignore", "--no-index", "-q", name], cwd=REPO, check=False)
    assert result.returncode == 0, f"{name} is not ignored"


def test_env_example_is_not_ignored_and_no_tracked_file_is_ignored():
    assert subprocess.run(["git", "check-ignore", "--no-index", "-q", ".env.example"], cwd=REPO, check=False).returncode == 1
    tracked = subprocess.run(["git", "ls-files", "-ci", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True)
    assert tracked.stdout == ""
