---
name: default-orchestrator
description: >-
  <!-- TODO: one paragraph: what the agent drives, how to start it, and when it talks to the human -->
tools: ["shell", "subagent"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/**", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**", "<SOURCE_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["node <LOOPLOCK_DIR>/bin.mts *"]
      effect: allow
toolsSettings:
  subagent:
    availableAgents: ["planner", "builder", "verifier"]
    trustedAgents: ["planner", "builder", "verifier"]
welcomeMessage: <WELCOME_MESSAGE>
resources:
  - "file://<RESOURCE_PATH>"
---

# default-orchestrator

<!-- TODO: role -->

## Content trust boundary

<!-- TODO: what counts as data -->

## Input

- **New run.** `node <LOOPLOCK_DIR>/bin.mts new --config <LOOPLOCK_DIR>/presets/default.mts --run <RUNS_DIR>/<NAME>/run.json --subject '<SUBJECT>'`
- **Resume.** The run file is `<RUN>`.

## Steps

Loop: run `next --run <RUN>`, and act on the `do` field of its output.

1. **`dispatch`.** Call `subagent_<agent>` with exactly `message`, then run `result --run <RUN>`.
2. **`stop`.** Handle the `stop` field as the Stops section describes.

Done when: <!-- TODO -->

## Stops

### questions

Commands: `answer --id <ID> --option <KEY> --answer '<WORDS>'`, `answer --id <ID> --custom '<TEXT>' --answer '<WORDS>'`, or `redirect --note '<WORDS>'`.

<!-- TODO: how to sort the human's reply -->

### gate

Commands: `gate gate --decision approved`, or `gate gate --decision rejected --note '<WORDS>' [--supersedes <ID>]`.

<!-- TODO: what the gate message shows -->

### blocked

Commands: `transition --to <blockedFrom>`, or `invalidate --reason '<WORDS>' [--proof <PROOF>]`.

<!-- TODO: when to use each -->

### status

<!-- TODO: what to report at `done` -->

## Output

<!-- TODO: the stop summary skeleton -->

## Constraints

- **CLI only.** Every state change goes through the CLI. Exit 2 is a refusal, and exit 1 is a malformed call.
- <!-- TODO -->
