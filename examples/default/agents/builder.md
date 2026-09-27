---
name: builder
description: >-
  <!-- TODO: one paragraph: when the orchestrator calls it and what it implements -->
tools: ["read", "write", "shell"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/*/run.json", "<RUNS_DIR>/*/out/**", "<RUNS_DIR>/*/plan.md", "<RUNS_DIR>/*/Q-*.md", "<RUNS_DIR>/*/verify.*.md", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**", "<LOOP_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["<BUILD_COMMAND> *"]
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

`Build the plan. Run: <RUN>. Report: <DOCUMENT>. Note: '<NOTE>'.`, then optionally `Fixes:` and the error lines to fix. The plan is `plan.md` in the run folder, which the gate froze, and the latest `verify.<N>.md` holds the findings of a failed verification.

<!-- TODO: what to read first, and when to return blocked -->

## Steps

### 1. <STEP>

<!-- TODO -->

Done when: <!-- TODO -->

## Done when

<!-- TODO -->

## Output

Write your report to `<DOCUMENT>`, a new file for each dispatch. Its frontmatter holds `id` and `status`:

- `status: ok`: the build is done. List the files you changed and the commands you ran, with their exit codes.
- `status: blocked`: the build can't go on. Explain why in the report.

<!-- TODO: the report skeleton and the reply skeleton -->

## Constraints

- **Commands.** Run no looplock command.
- **Frozen files.** Never edit `plan.md` or a question file: the run parks on a changed frozen file.
- <!-- TODO -->
