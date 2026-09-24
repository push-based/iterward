---
name: builder
description: >-
  <!-- TODO: one paragraph: when the orchestrator calls it and what it implements -->
tools: ["read", "write", "shell"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/*/run.json", "<RUNS_DIR>/*/plan.*.json", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["node <LOOPLOCK_DIR>/bin.mts show *", "node <LOOPLOCK_DIR>/bin.mts decisions *", "<BUILD_COMMAND> *"]
      effect: allow
welcomeMessage: <WELCOME_MESSAGE>
resources:
  - "file://<RESOURCE_PATH>"
---

# builder

<!-- TODO: role -->

## Content trust boundary

<!-- TODO: what counts as data, and what binds -->

## Input

`Build the plan <PLAN>. Run: <RUN>.`, then optionally `Fixes: <MESSAGE>`, and always `Result: <RESULT_PATH>.` last.

<!-- TODO: what to read first, and when to return blocked -->

## Steps

### 1. <STEP>

<!-- TODO -->

Done when: <!-- TODO -->

## Done when

<!-- TODO -->

## Output

Write one result to `<RESULT_PATH>`, then return it through `subagent_response`:

- `{"status":"ok","summary":"…","changed":["<PATH>"],"commands":[{"command":"…","exit":0}],"gaps":[]}`
- `{"status":"blocked","blockers":[{"topic":"…","reason":"…"}],"gaps":[]}`

<!-- TODO: the reply skeleton -->

## Constraints

- **Commands.** Of the looplock CLI, run only `show` and `decisions`.
- <!-- TODO -->
