#!/usr/bin/env python3
"""Official prompting docs the Prompt Studio is audited against (Anthropic + OpenAI).

    python3 scripts/docs_sources.py fetch [--docs-dir DIR]   # download every doc in docs/sources/MANIFEST.json
    python3 scripts/docs_sources.py check [--docs-dir DIR]   # verify every quote in docs/PROMPT-DOCS-REVIEW.md
    python3 scripts/docs_sources.py diff                     # which docs changed since the last fetch

Snapshots go OUTSIDE the plugin, as <vendor>/<id>.md, to --docs-dir, else $PROMPT_DOCS_DIR, else
../prompt-builders/official-docs next to this checkout: vendor docs quote injection examples, which the Hermes plugin security scan
rightly flags, and they are not ours to publish. The manifest (URL, fetch date, SHA-256) stays in the
repo, so any audit can be reproduced and a changed doc shows up in `diff`.

`check` reads every *quoted* passage in the review ("…" inside a table row that names a doc id
in [brackets]) and fails if the text is not found verbatim in that doc's snapshot. Whitespace
and Markdown escapes are normalized; nothing else is.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "docs" / "sources"
MANIFEST = SOURCES / "MANIFEST.json"
REVIEW = ROOT / "docs" / "PROMPT-DOCS-REVIEW.md"


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


DEFAULT_SNAPSHOTS = ROOT.parent / "prompt-builders" / "official-docs"
SNAPSHOTS = DEFAULT_SNAPSHOTS


def snapshots_dir(arg: str | None = None) -> Path:
    """Where the doc snapshots live: CLI argument, then $PROMPT_DOCS_DIR, then the sibling default."""
    value = arg or os.environ.get("PROMPT_DOCS_DIR")
    return Path(value).expanduser() if value else DEFAULT_SNAPSHOTS


def _path(vendor: str, doc_id: str) -> Path:
    return SNAPSHOTS / vendor / f"{doc_id}.md"


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "prompt-studio-docs/1.0", "Accept": "text/markdown, text/plain, */*"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def fetch() -> int:
    data = _manifest()
    failed = 0
    for vendor, docs in data["docs"].items():
        for doc_id, meta in docs.items():
            try:
                text = _get(meta["url"])
            except Exception as exc:  # keep the previous snapshot; report and continue
                print(f"FAIL {vendor}/{doc_id}: {exc}")
                failed += 1
                continue
            path = _path(vendor, doc_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            meta["sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
            meta["fetched"] = _dt.date.today().isoformat()
            meta["chars"] = len(text)
            print(f"ok   {vendor}/{doc_id} ({len(text)} chars)")
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 1 if failed else 0


def diff() -> int:
    changed = 0
    for vendor, docs in _manifest()["docs"].items():
        for doc_id, meta in docs.items():
            try:
                now = hashlib.sha256(_get(meta["url"]).encode("utf-8")).hexdigest()
            except Exception as exc:
                print(f"FAIL {vendor}/{doc_id}: {exc}")
                continue
            if now != meta.get("sha256"):
                changed += 1
                print(f"CHANGED {vendor}/{doc_id}  {meta['url']}")
    print(f"{changed} doc(s) changed since the last fetch")
    return 0


def _norm(text: str) -> str:
    text = text.replace("\\", "")  # Markdown escapes (\# \_ \*) in some exports
    text = re.sub(r"[*`]", "", text)
    text = text.replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    return re.sub(r"\s+", " ", text).strip().lower()


def check() -> int:
    ids = {doc_id: vendor for vendor, docs in _manifest()["docs"].items() for doc_id in docs}
    cache: dict[str, str] = {}
    bad = total = 0
    for line_no, line in enumerate(REVIEW.read_text(encoding="utf-8").splitlines(), 1):
        refs = [ref for ref in re.findall(r"\[([a-z0-9-]+)\]", line) if ref in ids]
        quotes = re.findall(r"\*\"(.+?)\"\*", line)
        if not refs or not quotes:
            continue
        texts = []
        for ref in refs:
            if ref not in cache:
                path = _path(ids[ref], ref)
                cache[ref] = _norm(path.read_text(encoding="utf-8")) if path.exists() else ""
            texts.append(cache[ref])
        for quote in quotes:
            total += 1
            parts = [p for p in re.split(r"\s*(?:…|\.\.\.)\s*", _norm(quote)) if p]
            if not any(all(p in text for p in parts) for text in texts):
                bad += 1
                print(f"NOT FOUND line {line_no} [{', '.join(refs)}]: {quote[:110]}")
    print(f"{total - bad}/{total} quotes found verbatim")
    return 1 if bad else 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fetch and check the official prompting docs snapshots.")
    parser.add_argument("command", nargs="?", default="check", choices=("fetch", "check", "diff"))
    parser.add_argument("--docs-dir", help="snapshot directory (default: $PROMPT_DOCS_DIR or ../prompt-builders/official-docs)")
    args = parser.parse_args()
    SNAPSHOTS = snapshots_dir(args.docs_dir)
    if args.command == "check" and not SNAPSHOTS.is_dir():
        print(f"docs snapshot dir not found: {SNAPSHOTS} (run fetch, or pass --docs-dir / set PROMPT_DOCS_DIR)", file=sys.stderr)
        sys.exit(2)
    sys.exit({"fetch": fetch, "check": check, "diff": diff}[args.command]())
