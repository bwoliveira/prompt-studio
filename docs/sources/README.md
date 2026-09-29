# Official sources behind the prompt rules

Local copies of the official vendor documentation quoted in `docs/PROMPT-DOCS-REVIEW.md`:
Anthropic (Claude Opus 5.5 and Claude Sonnet 5.5) and OpenAI (GPT-6 Astra). `MANIFEST.json` lists each one with its URL,
the date it was copied and its SHA-256.

The copies are kept **outside the plugin**, by default in `../prompt-builders/official-docs/<vendor>/<id>.md`
next to the checkout. Change the location with `--docs-dir` or the `PROMPT_DOCS_DIR` variable. They are
kept out because they quote prompt-injection examples, which the Hermes plugin security scan rejects.

```bash
python3 scripts/docs_sources.py fetch   # download everything again and update MANIFEST.json
python3 scripts/docs_sources.py diff    # list the documents that changed since the last copy
python3 scripts/docs_sources.py check   # check every quote in the review, word for word
```

For a future audit: run `diff`, re-read the review rows that cite each changed id (`[gpt6-using]`,
`[opus55-prompting]`, `[sonnet55-prompting]`, …), then run `check`.
