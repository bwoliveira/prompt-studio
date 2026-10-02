# How each model's prompt is built

The three models need different prompts, and the engines follow each vendor's guidance:

- **Claude Opus 5.5** (Anthropic, *Prompting Claude Opus 5.5* and the prompting best practices):
  - Pasted material goes in `<pasted_content>` tags with the documented note; long material goes above the task.
  - Autonomy is stated plainly, and "explore first" is added when the request gives little context.
  - Scope stays to what was asked.
  - No "double-check your work" lines: Opus verifies on its own, so the prompt asks for evidence instead,
    such as the commands run and what they returned.
- **GPT-6 Astra** (OpenAI, *Using GPT-6* and *Rethinking skills and prompts for GPT-6 Astra*):
  - The request is stated to take precedence over skills and `AGENTS.md`.
  - An action request is framed as work to finish, not a plan to propose.
  - Only the official testing line is used, without extra verification lines.
  - The plain-writing lines apply to texts, analyses and reports; a plain answer to a question gets neither them nor a
    `DONE WHEN` line, so a trivial question stays as short as the Opus prompt.
  - Pasted material goes last, inside `<document>` tags.
- **Claude Sonnet 5.5** (Anthropic, *Prompting Claude Sonnet 5.5*):
  - Autonomy wording keeps it working through a long task: at low and medium effort it can stop to check in
    before the work is done.
  - Scope stays to what was asked: it tends to add tests, documentation and small supporting files on its own.
  - The prompt never asks it to write out its reasoning in the answer.
- **All three models:**
  - An optional **subagents** step. "Team" splits the task into independent parts that run in parallel,
    and names one reviewer who did not write any of the work and starts from a fresh context.
  - Examples go in `<example>` tags.
  - Pasted text is escaped so it cannot close its tags, and it is marked as data, not instructions.

`PROMPT-DOCS-REVIEW.md` lists every rule line with the quote it comes from.
