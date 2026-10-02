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
    assert "gitleaks detect" in commands


def gitleaks_steps(workflow: dict) -> list[dict]:
    return next(job["steps"] for job in workflow["jobs"].values() if job["name"] == "gitleaks")


def test_gitleaks_scans_every_commit_of_the_explicit_range_not_what_gitleaks_action_picks(workflow):
    """gitleaks-action v3 takes the first and last commit of the first 30 the PR API returns and passes
    `--no-merges --first-parent`: a secret in commit 31+ or in a merged side branch goes unscanned."""
    steps = gitleaks_steps(workflow)
    assert not [s for s in steps if s.get("uses", "").startswith("gitleaks/")], "gitleaks-action is not used"
    scan = "\n".join(s["run"] for s in steps if "gitleaks detect" in s.get("run", ""))
    assert "--first-parent" not in scan and "--no-merges" not in scan
    assert "--log-opts" in scan
    envs = {k: v for s in steps if "gitleaks detect" in s.get("run", "") for k, v in s.get("env", {}).items()}
    assert "pull_request.base.sha" in " ".join(envs.values()) and "pull_request.head.sha" in " ".join(envs.values())
    assert "github.event.before" in " ".join(envs.values())
    assert "$PR_BASE..$PR_HEAD" in scan and "$PUSH_BEFORE..$PUSH_AFTER" in scan


def test_gitleaks_binary_is_a_pinned_version_with_a_verified_checksum(workflow):
    install = "\n".join(s.get("run", "") for s in gitleaks_steps(workflow))
    assert re.search(r"sha256sum -c", install), "the downloaded binary is checked against a pinned checksum"
    env = next(job["env"] for job in workflow["jobs"].values() if job["name"] == "gitleaks")
    assert re.fullmatch(r"\d+\.\d+\.\d+", str(env["GITLEAKS_VERSION"]))
    assert re.fullmatch(r"[0-9a-f]{64}", env["GITLEAKS_SHA256"])


def test_gitleaks_checkout_fetches_the_history_its_commit_range_needs(workflow):
    steps = gitleaks_steps(workflow)
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


def test_bin_pr_requires_exactly_the_jobs_of_the_workflow(workflow):
    """The merge gate names the jobs it waits for; they must stay equal to the job names in ci.yml."""
    declared = re.search(r"^REQUIRED_CHECKS=\((.*)\)$", (REPO / "bin" / "pr").read_text(), re.M)
    assert declared, "bin/pr declares REQUIRED_CHECKS"
    required = re.findall(r'"([^"]+)"', declared.group(1))
    assert sorted(required) == sorted(job["name"] for job in workflow["jobs"].values())


def test_docs_say_gitleaks_scans_the_commit_range_not_the_whole_history():
    for doc in ("README.md", "docs/DESKTOP-DEV.md"):
        text = (REPO / doc).read_text()
        assert "gitleaks over the full history" not in " ".join(text.split()), doc
