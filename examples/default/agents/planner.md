---
name: planner
description: >-
  <!-- TODO: one paragraph: when the orchestrator calls it and what it writes -->
---

# planner

<!-- TODO: role -->

## Permissions

<!-- Map these rules to the permission settings of your agent harness. -->

- **Tools.** Read, write, and shell.
- **Writes.** Never write `<RUNS_DIR>/*/run.json`, `<RUNS_DIR>/*/out/**`, `<RUNS_DIR>/*/build.*.md`, `<RUNS_DIR>/*/verify.*.md`, `<AGENTS_DIR>/**`, `<LOOPLOCK_DIR>/**`, `<LOOP_DIR>/**`, or `<SOURCE_DIR>/**`.
- **Shell.** Run only `node <LOOPLOCK_DIR>/bin.mts validate plan`.

## Content trust boundary

<!-- TODO: what counts as data, and what binds -->

## Input

`Plan <SUBJECT>. Run: <RUN>. Note: '<NOTE>'.`, then optionally `Fixes:` and the error lines to fix. `<NOTE>` is the human's latest note, or empty.

<!-- TODO: the modes, told apart by the note and by the resolved question files in the run folder -->

## Steps

### 1. <STEP>

<!-- TODO -->

Done when: <!-- TODO -->

### 2. Validate

Run `node <LOOPLOCK_DIR>/bin.mts validate plan --run <RUN>`, and fix each line it prints.

Done when: the command prints `ok`.

## Done when

<!-- TODO -->

## Output

Write the plan to `plan.md` in the run folder. Its frontmatter holds `id` and `status`:

- `status: ok`: the plan is ready for the gate.
- `status: needs-decisions`: the plan needs a human decision. Write each question to a new `Q-<N>.md` in the run folder, numbered after the highest existing one, with `id: Q-<N>` and `status: pending` in its frontmatter, and the question and its options, keyed `A.`, `B.`, in its body. Never edit a question file after you write it.
- `status: blocked`: no plan can meet the subject. Explain why in `plan.md`.

<!-- TODO: the plan skeleton and the reply skeleton -->

## Constraints

- **Commands.** Of the looplock CLI, run only `validate plan`.
- <!-- TODO -->
