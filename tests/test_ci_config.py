"""CI contract: declared Python test dependencies and the GitHub Actions workflow that runs every check."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "ci.yml"
REQUIREMENTS = REPO / "requirements-dev.txt"


def requirement_lines() -> list[str]:
    return [line.strip() for line in REQUIREMENTS.read_text().splitlines() if line.strip() and not line.startswith("#")]


def test_python_test_dependencies_are_declared_and_pinned():
    pins = dict(line.split("==", 1) for line in requirement_lines())
    assert set(pins) == {"pytest", "fastapi", "httpx", "pyyaml"}, pins
    assert all(re.fullmatch(r"\d+(\.\d+)+", version) for version in pins.values()), pins


@pytest.fixture(scope="module")
def workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def all_steps(workflow: dict) -> list[dict]:
    return [step for job in workflow["jobs"].values() for step in job["steps"]]


def run_commands(workflow: dict) -> str:
    return "\n".join(step["run"] for step in all_steps(workflow) if "run" in step)


def test_workflow_runs_on_pull_requests_and_pushes_to_main(workflow):
    triggers = workflow.get(True, workflow.get("on"))  # PyYAML reads the key `on` as the boolean True
    assert "pull_request" in triggers
    assert triggers["push"]["branches"] == ["main"]


def test_workflow_has_read_only_permissions_and_runs_on_github_hosted_runners(workflow):
    assert workflow["permissions"] == {"contents": "read", "pull-requests": "read"}
    assert {job["runs-on"] for job in workflow["jobs"].values()} == {"ubuntu-latest"}
    assert all("timeout-minutes" in job for job in workflow["jobs"].values()), "no job can hang for the 6 h default"


def test_workflow_runs_every_check(workflow):
    commands = run_commands(workflow)
    assert "node scripts/build.mjs --check" in commands
    assert re.search(r"^npm ci$", commands, re.M)
    assert re.search(r"^npm test$", commands, re.M), "the UI tests run through npm test (no silent skip)"
    assert "npm run test:bin" in commands
    assert "pip install -r requirements-dev.txt" in commands
    assert "pytest -q tests" in commands
    uses = [step["uses"] for step in all_steps(workflow) if "uses" in step]
    assert any(u.startswith("gitleaks/gitleaks-action@") for u in uses)


def test_gitleaks_scans_the_whole_history(workflow):
    steps = next(job["steps"] for job in workflow["jobs"].values() if any(s.get("uses", "").startswith("gitleaks/") for s in job["steps"]))
    checkout = next(s for s in steps if s.get("uses", "").startswith("actions/checkout@"))
    assert checkout["with"]["fetch-depth"] == 0


def test_every_action_is_pinned_to_a_major_version_tag(workflow):
    for step in all_steps(workflow):
        if "uses" in step:
            assert re.fullmatch(r"[\w.-]+/[\w.-]+@v\d+", step["uses"]), step["uses"]


def test_python_job_installs_from_the_declared_file_with_a_cache_keyed_on_it(workflow):
    steps = next(job["steps"] for job in workflow["jobs"].values() if any("pytest" in s.get("run", "") for s in job["steps"]))
    setup = next(s for s in steps if s.get("uses", "").startswith("actions/setup-python@"))
    assert setup["with"]["cache-dependency-path"] == "requirements-dev.txt"


def test_docs_name_the_declared_files():
    for doc in ("README.md", "docs/DESKTOP-DEV.md"):
        text = (REPO / doc).read_text()
        assert "requirements-dev.txt" in text and "npm ci" in text, doc
    agents = (REPO / "AGENTS.md").read_text()
    ci_lines = [line for line in agents.splitlines() if "ci.yml" in line]
    assert len(ci_lines) == 1 and "bin/pr" in ci_lines[0], ci_lines
