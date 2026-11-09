"""The user-facing docs keep their shape: a short README, six ADRs, a glossary."""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADRS = sorted((REPO / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))


def test_readme_is_user_sized_and_links_the_contributor_docs():
    text = (REPO / "README.md").read_text()
    # 200 lines of text plus the art block under the intro (feature cards and the how-it-works strip).
    assert len(text.splitlines()) <= 210
    for link in ("CONTRIBUTING.md", "docs/DESKTOP-DEV.md", "docs/adr/", "CONTEXT.md", "docs/CONTRACT.md"):
        assert link in text, link
    for dev_heading in ("## Tests", "## Continuous integration", "## Hermes plugin guidelines", "## Repository layout"):
        assert dev_heading not in text, dev_heading


README_IMAGE = re.compile(r'(?:src="|\]\()(docs/images/[^")]+)')
# Shown on the plugin catalog card, which reads it from the repository and not from the README.
CATALOG_IMAGES = {"banner.png"}
IMAGE_MAGIC = {".png": b"\x89PNG\r\n\x1a\n", ".jpg": b"\xff\xd8\xff"}


def test_readme_images_exist_and_docs_images_holds_nothing_else():
    used = set(README_IMAGE.findall((REPO / "README.md").read_text()))
    assert len(used) >= 8, sorted(used)
    for name in used:
        assert (REPO / name).is_file(), name
    kept = {f"docs/images/{p.name}" for p in (REPO / "docs" / "images").iterdir()}
    assert kept == used | {f"docs/images/{name}" for name in CATALOG_IMAGES}


def test_docs_images_are_real_images_of_a_size_fit_for_a_plugin_checkout():
    for path in sorted((REPO / "docs" / "images").iterdir()):
        assert path.suffix in IMAGE_MAGIC, path.name
        data = path.read_bytes()
        assert data.startswith(IMAGE_MAGIC[path.suffix]), path.name
        assert len(data) <= 512 * 1024, f"{path.name}: {len(data)} bytes"


def test_the_catalog_banner_is_two_to_one():
    # The catalog card crops anything else: PNG width and height sit at bytes 16-24 of the file.
    data = (REPO / "docs" / "images" / "banner.png").read_bytes()
    assert (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")) == (1200, 600)


def test_docs_promise_a_recommendation_on_choices_only():
    # Text steps have none of their own (tests/desktop/studio-core.test.mjs pins it), so "every step" is untrue.
    claim = re.compile(r"(?:each|every) step\b[^.]{0,60}recommend|\beach with a recommended|recommended \w+ on each\b", re.I)
    for name in ("README.md", "docs/STEPS-REVIEW.md"):
        assert not claim.search((REPO / name).read_text()), name


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
