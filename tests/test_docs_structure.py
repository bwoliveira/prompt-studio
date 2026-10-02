"""The user-facing docs keep their shape: a short README, six ADRs, a glossary."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADRS = sorted((REPO / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))


def test_readme_is_user_sized_and_links_the_contributor_docs():
    text = (REPO / "README.md").read_text()
    assert len(text.splitlines()) <= 200
    for link in ("CONTRIBUTING.md", "docs/DESKTOP-DEV.md", "docs/adr/", "CONTEXT.md", "docs/CONTRACT.md"):
        assert link in text, link
    for dev_heading in ("## Tests", "## Continuous integration", "## Hermes plugin guidelines", "## Repository layout"):
        assert dev_heading not in text, dev_heading


def test_six_adrs_each_with_status_context_decision_consequences():
    assert [p.name[:4] for p in ADRS] == ["0001", "0002", "0003", "0004", "0005", "0006"]
    for adr in ADRS:
        lines = adr.read_text().splitlines()
        assert lines[0].startswith("# "), adr.name
        assert any(line.startswith("Status: ") for line in lines), adr.name
        for heading in ("## Context", "## Decision", "## Consequences"):
            assert heading in lines, (adr.name, heading)


def test_context_md_is_a_glossary_only():
    text = (REPO / "CONTEXT.md").read_text()
    assert text.count("\n**") >= 10
    assert "```" not in text


def test_repo_docs_never_hard_code_the_hermes_home_path():
    docs = [REPO / n for n in ("README.md", "CONTRIBUTING.md", "CONTEXT.md")] + sorted((REPO / "docs").rglob("*.md"))
    for doc in docs:
        assert "/root/.hermes" not in doc.read_text(), doc.name


def test_subagent_recommendation_in_the_docs_is_the_engines_default():
    """The engines recommend 'the model decides' (auto); the docs must not still recommend a team."""
    review = (REPO / "docs" / "PROMPT-DOCS-REVIEW.md").read_text()
    section = review.split("## 3. Subagents (all targets)")[1].split("\n## 4.")[0]
    assert "**model decides** (recommended" in section
    assert "team** (recommended" not in section
    assert "prioritize subagents" not in section
    steps = next(line for line in (REPO / "docs" / "STEPS-REVIEW.md").read_text().splitlines() if line.startswith("| 8 |"))
    assert "Astra also recommends \"model decides\"" in steps and "Sonnet also recommends \"model decides\"" in steps
