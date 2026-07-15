---
name: build-review-plan
description: Builds a time-bounded study schedule from topics, deadline, available study time, and optional results the user explicitly includes in the current request. Use only when the user asks for a study plan, cram plan, review sequence, or what to study next. Do not invoke merely because a deadline is mentioned. Does not read or edit calendars. Invoke silently and return only the format-locked plan.
---

# Build a review plan

Convert the learner's deadline, available time, topics, and supplied evidence into a realistic sequence of retrieval and correction.

## Final-response boundary

Invoke this skill silently. Return only the finished plan; never announce the skill, describe the workflow, or add a preface. The first line must be `# Review plan` when the learner supplied no title, or `# Review plan: [exact learner-supplied title]` when they did. The next content after the title must be `## Main plan`; do not place an overview, allocation summary, rationale, or other prose between them.

Never mention tool use, file reads, reference loading, unavailable tools, errors, limitations of the execution environment, or internal process. If a referenced file cannot be read, continue with the rules present in this skill and do not disclose the failure in the plan.

When only topic labels are supplied, the final non-blank line must be exactly `Done when: [N] statements have each been checked and any mismatch revised.`, substituting the same number used in the single `Start now` task. Stop immediately after that line. Do not append a recap, offer, follow-up question, adjustment note, or any other prose.

## Mandatory output when only topic labels are supplied

Use the literal title `Review plan` unless the learner supplied an explicit title. Output all five sections below; none may be omitted:

1. `Main plan`—a table with one exact topic label per topic-work row; never an `all topics`, `mixed`, or combined row.
2. `Minute arithmetic`—an equation for every window and one overall equation.
3. `Buffer`—identify the buffer row and minutes from the main table.
4. `Minimum viable fallback`—assume the learner misses the first entire availability window (for example, all 30 minutes labeled `this afternoon`), not an individual topic block. Show a replacement table using only later windows that remain, and print all four equations: original total; missed window; `remaining availability = original total - missed window`; `scheduled fallback + unused remaining minutes = remaining availability`. Never choose a weak topic or task row as the missed session.
5. `Start now`—one topic only, using the literal safe task and done-when sentences below.

Every topic-work task, including fallback, must be exactly: `Write [N] statements about [exact topic label] from your course material; check each statement against that material; revise any mismatch.` Its criterion must be exactly: `[N] statements have each been checked and any mismatch revised.` Change only N and the exact topic label. A buffer row must use exactly: `Reserve this time for delays; if it is not needed, stop.` Criterion: `The reserved minutes are not exceeded.` Do not add an overview, subject-matter title, study-method explanation, `deep work`, `solid/fragile` claim, or prose after `Start now`.

In the `Buffer` section, repeat only the buffer window, minutes, literal buffer task, and criterion. Do not say the buffer can be used for retrieval, unstable topics, extra work, or any other purpose.

## Source boundary for plans

A plan may be built from topic names without course content, but topic names authorize **scheduling only**, not subject-matter generation. When the learner supplies no study text, use the topic labels exactly as given and use only the format-locked statement-writing/checking task below. Do not request `main points`, definitions, questions, examples, mechanisms, structures, components, formulas, processes, comparisons, likely misconceptions, diagnostic questions, or factual done-criteria from general knowledge.

When no study text is present, use procedural quantities for execution: “write three source-backed statements,” “write two questions using wording from your source,” “answer them,” and “check each answer against the source.” Do not tell the learner to list components, types, causes, effects, mechanisms, characteristics, examples, or distinctions unless the learner's supplied text establishes that those exist.

When no study text is present, the only permitted task verbs are content-neutral actions such as `write`, `retrieve`, `check`, `mark`, `revise`, `answer`, and `re-check`. Do not ask for a topic's main point, definition, mechanism, conditions, components, types, characteristics, examples, causes, effects, or differences. Do not create a comparison between topic labels. A safe task is: “Write three statements about [exact topic label] from your course material, check each statement against that material, and revise any mismatch.”

This rule is format-locked when the learner supplies topic labels without study text: use the safe task sentence above (changing only the number and exact topic label) instead of paraphrasing it. Do not use `main point`, `what you know`, `deep`, `understanding`, or another phrase that implies unstated subject-matter structure.

In that case, every topic-work table cell—including fallback and `Start now`—must contain this literal sentence: `Write [N] statements about [exact topic label] from your course material; check each statement against that material; revise any mismatch.` The `Done when` cell must be: `[N] statements have each been checked and any mismatch revised.` Do not replace the task with labels such as `retrieve and check`, `correction cycle`, `mixed retrieval`, or `quick check`. Do not combine two topic labels in one work block.

Never create an `all topics`, `mixed check`, or multi-topic row when only topic labels were supplied. Allocate separate rows. A buffer row is not topic work; its task must be exactly `Reserve this time for delays; if it is not needed, stop.` and its done criterion must be `The reserved minutes are not exceeded.` Do not turn buffer or flex time into extra subject-matter work.

## Workflow

1. Gather the deadline, topics, available minutes or study windows, and hard constraints. Ask only for missing information that materially changes the plan.
2. If information remains missing, make conservative assumptions and list them prominently.
3. Read [learning integrity and source handling](../../references/learning-integrity.md) and the [review planning heuristics](references/planning-heuristics.md).
4. Prioritize user-identified weak or important topics. Use supplied quiz results when available; never invent performance evidence or predict exam content.
5. Sequence diagnostic retrieval, targeted correction, spaced re-checks when time permits, and a final mixed check.
6. Assign every session a duration, concrete task, source or topic, and observable “done when” criterion. If no source text was supplied, keep the task content-neutral and make the criterion procedural, such as completing a requested number of source-checked retrieval prompts—not demonstrating an invented fact.
7. Include a buffer and a minimum viable fallback for missed sessions.
   - Give the fallback its own explicit minute total. Recalculate fallback availability after the named missed session: do not count minutes from the missed window. If it deliberately uses less than the remaining available time, subtract and label the unused minutes; never silently drop time.
8. Render with the [review plan template](templates/review-plan.md).
9. Check that the scheduled minutes fit the learner's stated availability.
10. Add explicit arithmetic for every study window and for the overall plan. Sum every work block, break, transition, and buffer. Reconcile any narrative allocation claim with the actual table; delete the claim if it does not match exactly.
11. Finish with one action the learner can start immediately.
12. Audit every domain-specific noun phrase in the plan. Except for the learner's own topic names, remove it unless it appears in text the learner supplied in the current request. Do not fill source gaps from general knowledge.
13. If only topic labels were supplied, search the draft for `main point`, `definition`, `mechanism`, `condition`, `component`, `type`, `characteristic`, `example`, `cause`, `effect`, `difference`, and `distinguish`. Replace every occurrence with a content-neutral, source-checkable action.
14. When a fallback is present, describe only its blocks and arithmetic. Do not claim it sacrifices or preserves a kind of review unless that claim follows exactly from the listed blocks.
15. Run a fallback arithmetic audit: the missed unit must be a complete availability window supplied by the learner, never an individual topic-work row. Use `remaining availability = total availability - missed-window minutes`; `scheduled fallback + unused remaining minutes = remaining availability`. Never say the fallback uses a portion of the original total when the stated scenario removes a window.
16. If a fallback is shown, print all four arithmetic lines from the template: original total, missed window, remaining availability subtraction, and fallback sum including unused minutes. Do not replace them with prose.
17. When only topic labels were supplied, `Start now` must contain exactly one safe task sentence and its matching `Done when` sentence from the format lock. Do not paraphrase or add word-by-word checking instructions.
18. Before returning a topic-label-only plan, verify that all five mandatory section headings are present, no topic-work row contains more than one topic label, and the fallback contains all four required arithmetic lines.

## Boundaries

- Do not invoke this skill merely because the learner mentions a deadline; require an explicit planning request.
- Do not read or edit calendars, schedule reminders, browse for a syllabus, inspect uploads, retrieve prior chats, query memory, or claim access to existing Noteflix data.
- Do not make health claims, guarantee outcomes, or predict grades.
- Do not treat guessed availability or topic weights as facts.
- Do not create factual retrieval questions or examples from topic names alone. Refer the learner back to their own course material when source text is absent.
