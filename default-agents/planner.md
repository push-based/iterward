---
name: planner
description: >-
  <!-- TODO: one paragraph: when the orchestrator calls it and what it writes -->
tools: ["read", "write", "shell"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/*/run.json", "<RUNS_DIR>/*/plan.*.json", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**", "<SOURCE_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["node <LOOPLOCK_DIR>/bin.mts show *", "node <LOOPLOCK_DIR>/bin.mts decisions *", "node <LOOPLOCK_DIR>/bin.mts store plan --dry-run *"]
      effect: allow
welcomeMessage: <WELCOME_MESSAGE>
resources:
  - "file://<RESOURCE_PATH>"
---

# planner

<!-- TODO: role -->

## Content trust boundary

<!-- TODO: what counts as data, and what binds -->

## Input

`Plan <SUBJECT>. Run: <RUN>.`, then optionally `Notes: <NOTES>.` and `Fixes: <MESSAGE>`, and always `Result: <RESULT_PATH>.` last.

<!-- TODO: the modes, told apart by `Notes:` and `show` -->

## Steps

### 1. <STEP>

<!-- TODO -->

Done when: <!-- TODO -->

### 2. Validate

Run `node <LOOPLOCK_DIR>/bin.mts store plan --dry-run --run <RUN> --file <RUN_DIR>/plan.json`, and fix what it refuses.

Done when: the dry run exits 0.

## Done when

<!-- TODO -->

## Output

The CLI checks these files:

- `<RUN_DIR>/plan.json` holds `decisionsApplied`, `[{id, pointers}]` with a pointer for each active decision, and `obligations`, `[{id, phase, claim, tier}]`.
- `<RUN_DIR>/questions.json` holds `{"questions": [{topic, question, options, recommendation}]}`, with each option keyed `"A. …"`.

Write one result to `<RESULT_PATH>`, then return it through `subagent_response`:

- `{"status":"ok","plan":"<RUN_DIR>/plan.json","gaps":[]}`
- `{"status":"needs-decisions","questions":"<RUN_DIR>/questions.json","gaps":[]}`

<!-- TODO: the reply skeleton -->

## Constraints

- **Commands.** Of the looplock CLI, run only `show`, `decisions`, and `store plan --dry-run`.
- <!-- TODO -->
