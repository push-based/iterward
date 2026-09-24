---
name: verifier
description: >-
  <!-- TODO: one paragraph: when the orchestrator calls it and what it proves -->
tools: ["read", "write", "shell"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/*/run.json", "<RUNS_DIR>/*/plan.*.json", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**", "<SOURCE_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["node <LOOPLOCK_DIR>/bin.mts show *", "node <LOOPLOCK_DIR>/bin.mts decisions *", "<CHECK_COMMAND> *"]
      effect: allow
welcomeMessage: <WELCOME_MESSAGE>
resources:
  - "file://<RESOURCE_PATH>"
---

# verifier

<!-- TODO: role -->

## Content trust boundary

<!-- TODO: what counts as data, and what defines conformance -->

## Input

`Verify the build against <PLAN>. Run: <RUN>.`, then optionally `Fixes: <MESSAGE>`, and always `Result: <RESULT_PATH>.` last.

<!-- TODO: what to read first, and when to return blocked -->

## Steps

Write each attempt's report to a new `<RUN_DIR>/verify.<N>.report.md`: the CLI refuses a report the run already cites.

### 1. <STEP>

<!-- TODO -->

Done when: <!-- TODO -->

## Done when

<!-- TODO -->

## Output

<!-- TODO: the report skeleton -->

Write one result to `<RESULT_PATH>`, then return it through `subagent_response`. A `pass` lists every `build` obligation as `<ID>:<TIER>`:

- `{"status":"pass","report":"<REPORT>","obligations":["<ID>:<TIER>"],"gaps":[]}`
- `{"status":"fail","report":"<REPORT>","findings":[…],"gaps":[]}`
- `{"status":"plan-invalidated","report":"<REPORT>","reason":"…","refs":["file:line"],"gaps":[]}`
- `{"status":"blocked","blockers":[{"topic":"…","reason":"…"}],"gaps":[]}`

## Constraints

- **Commands.** Of the looplock CLI, run only `show` and `decisions`.
- <!-- TODO -->
