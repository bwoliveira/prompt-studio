# How each model's prompt is built

The four models need different prompts, and the engines follow each vendor's guidance:

- **Claude Opus 5.5** (Anthropic, *Prompting Claude Opus 5.5* and the prompting best practices):
  - Pasted material goes in `<pasted_content>` tags with the documented note; long material goes above the task.
  - Autonomy is stated plainly, and "explore first" is added when the request gives little context.
  - Scope stays to what was asked.
  - No "double-check your work" lines: Opus verifies on its own, so the prompt asks for evidence instead,
    such as the commands run and what they returned. After a done-criterion you wrote, only that evidence line follows,
    not a generic "done when the behavior works".
- **GPT-6 Astra** (OpenAI, *Using GPT-6* and *Rethinking skills and prompts for GPT-6 Astra*):
  - The request is stated to take precedence over skills and `AGENTS.md`.
  - An action request is framed as work to finish, not a plan to propose.
  - Only the official testing line is used, without extra verification lines.
  - The plain-writing lines apply to texts, analyses and reports; a plain answer to a question gets neither them nor a
    `DONE WHEN` line, so a trivial question stays as short as the Opus prompt.
  - Pasted material goes last, inside `<document>` tags.
- **Claude Sonnet 5.5** (Anthropic, *Prompting Claude Sonnet 5.5*):
  - Pasted material goes in `<document>` tags (not `<pasted_content>`); long material goes above the task.
  - A done-criterion is followed by the doc's check-before-done paragraph for code work: a real check that exercises the
    change, never a syntax-only one.
  - Autonomy wording keeps it working through a long task: at low and medium effort it can stop to check in
    before the work is done.
  - Scope stays to what was asked: it tends to add tests, documentation and small supporting files on its own.
  - The prompt never asks it to write out its reasoning in the answer.
- **Claude Fable 5.2** (Anthropic, *Prompting Claude Fable 5.2*):
  - Autonomy uses the guide's own "finishing work" text: Fable can end a turn before the work is done, more often at low
    and medium effort. The unattended mode adds the part that tells ordinary obstacles (errors, timeouts, failing
    tools: work through them) from deliberate blockers (a file marked not to be touched, withheld access: leave them
    alone and report).
  - Approval rules are applied as written, so "Clarify first" names what needs your answer and, in the same rule, what
    needs no approval. No general "ask first" line is added.
  - The default subagent line puts cost first, then when delegating pays off, then how to brief a subagent; it also
    says not to start subagents to review its own work unless you asked for a review.
  - Hands-on work gets a one-line progress update every few tool calls (not in the unattended mode) and a final report
    written for a reader who has not seen the tool calls.
  - Pasted material goes in `<document>` tags, as for Sonnet. Scope stays to what was asked, and the prompt never says
    the code is the model's own.
  - No lines that ask for less thinking (they have no effect on this model), no hard limits on sentence or word
    counts, and the prompt never asks it to write out its reasoning in the answer.
- **All four models:**
  - An optional **subagents** step. "Team" splits the task into independent parts that run in parallel,
    and names one reviewer who did not write any of the work and starts from a fresh context.
  - Examples go in `<example>` tags.
  - Pasted text is escaped so it cannot close its tags, and it is marked as data, not instructions. When the text
    holds `<` or `&`, one line tells the model that `&lt;` and `&amp;` stand for them.
  - The subagents step recommends "the model decides" on every target; a team is added only when you pick it, one
    rule per line.

`PROMPT-DOCS-REVIEW.md` lists every rule line with the quote it comes from.
