# Prompt Studio: why each step is asked

A step stays only if (a) its answer changes the generated prompt and (b) it is a decision only the user can
make inside a Hermes session. Everything the engine can read from the draft, and everything the Hermes session
already decides, is not asked. The prompt lines each answer produces, with their doc sources, are in
[PROMPT-DOCS-REVIEW.md](PROMPT-DOCS-REVIEW.md).

Every step has a recommended answer (the engine's default or the AI suggestion) and can be skipped; a skipped
step uses the recommendation.

## Steps asked (v1 order)

| # | Step | Targets | Why it is asked | What it changes |
|---|---|---|---|---|
| 1 | What do you want to get at the end? (deliverable) | both | The deliverable decides which rule lines apply (act vs. read-only, evidence lines, subagent default). The engine detects it from the draft and shows it as the recommendation; asking lets the user correct a wrong guess. A choice that contradicts the draft is kept and reported in the notes. | Autonomy, DONE WHEN and subagent lines (O10, O28, A7, A8, A22-A26) |
| 2 | Any reference text to paste? | both | Only the user knows they have third-party material; the AI is not asked to fill it. | THIRD-PARTY MATERIAL block with the injection note (O2-O6, A32-A33) |
| 2b | Where did that text come from? | both, only after a paste | Anthropic: say what the content is and where it came from. | `Source, as described by the user` / `<source>` |
| 3 | What context does the model need? | both | Facts, audience, stack, what exists and why it matters; the model cannot guess them. | CONTEXT section; empty context on hands-on Opus tasks adds the "explore first" line (O8) |
| 4 | Which rules must not be broken? | both | Hard constraints are the user's. Help text: say what to do, not only what to avoid. | REQUIREMENTS section |
| 5 | How will you know it is done? | both | A checkable definition of done replaces the engine's generic line. | DONE WHEN section |
| 6 | Interface patterns to avoid | Opus, code tasks only | The Opus 5.5 page recommends naming the visual patterns to avoid; the list is a taste call. "Avoid nothing" drops the line. | REQUIREMENTS design line (O11) |
| 7 | How much autonomy? | both (Opus adds "unattended") | How far the model may go without checking in depends on the user's situation, not the draft. | AUTONOMY section (O12-O15, A7-A13) |
| 8 | Use subagents? | both | Team, model decides, or none. For Opus "model decides" is recommended (it carries the guide's delegation rule for hands-on work); team only when the user picks it, since delegation multiplies cost and time on small tasks. Astra also recommends "model decides" (the guide's own conditional delegation line plus the legibility line; nothing for a single text or answer); team (split + reviewer) only when the user picks it. | SUBAGENTS section (section 3 of the rule reference) |
| 9 | Do you have an example of the result? | both, not for code or agent tasks | Examples steer format and tone; only the user has real ones. Several examples are separated by a `---` line. | EXAMPLE/EXAMPLES section |
| 10 | Response format | both | Prose, steps, table or JSON is a use-case choice. Default: match the task (no line). | OUTPUT format line |
| 11 | Response length | both | Concise vs. detailed is a reader preference. Default: balanced (no line). | OUTPUT length line |

## Not asked, and why

| Not asked | Why |
|---|---|
| Reasoning effort | A Hermes session setting (the effort control in the composer). The prompt does not state it; both vendors treat effort as an API parameter, not prompt text. |
| Available tools | Hermes knows the real tools of the session. Listing tools in the prompt can contradict it, and no vendor doc asks for it. |
| Web browsing | Same: browsing is a Hermes tool with its own policy. |
| Category (code, research, writing…) | Detected from the draft; asking would only repeat the detection. The deliverable step covers intent. |
| Depth / thoroughness | Covered by the length step and the definition of done; a separate "depth" knob would duplicate them, and asking for more written reasoning is discouraged by both vendors. |
| Answer language | The engines always add "answer in the language the task is written in, unless the requirements say otherwise". A different language goes in the requirements step. |
| Prompt structure | Section layout is fixed by the engines from the vendor docs; it is not a user decision. |

## Where the AI helps

- **Per-step suggestion** (automatic mode): for each step the AI proposes an option or draft text and says
  whether it agrees with the recommendation. It never invents examples or the origin of pasted text.
- **Improve my text** on free-text steps.
- **Generate with AI**: an AI writer turns the engine's prompt and the answers into the final prompt. It may
  reorganize and clarify, never invent reasons, audiences, fields or capabilities. If it fails or times out, the
  engine's prompt is used unchanged and a note says so.
