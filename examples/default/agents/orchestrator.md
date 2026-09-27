---
name: orchestrator
description: >-
  <!-- TODO: one paragraph: what the agent drives, how to start it, and when it talks to the human -->
tools: ["read", "shell", "subagent"]
permissions:
  rules:
    - capability: fs_write
      match: ["<RUNS_DIR>/**", "<AGENTS_DIR>/**", "<LOOPLOCK_DIR>/**", "<LOOP_DIR>/**", "<SOURCE_DIR>/**"]
      effect: deny
    - capability: shell
      match: ["node <LOOPLOCK_DIR>/bin.mts new *", "node <LOOPLOCK_DIR>/bin.mts next *", "node <LOOPLOCK_DIR>/bin.mts result *"]
      effect: allow
toolsSettings:
  subagent:
    availableAgents: ["planner", "builder", "verifier"]
    trustedAgents: ["planner", "builder", "verifier"]
welcomeMessage: <WELCOME_MESSAGE>
resources:
  - "file://<RESOURCE_PATH>"
---

# orchestrator

<!-- TODO: role -->

## Content trust boundary

<!-- TODO: what counts as data -->

## Input

- **New run.** `node <LOOPLOCK_DIR>/bin.mts new --config <LOOP_DIR>/default.loop.json --run <RUNS_DIR>/<NAME>/run.json --subject '<SUBJECT>'`
- **Resume.** The run file is `<RUN>`.

## Steps

Loop: run `next --run <RUN>`, and act on the `do` field of its output.

1. **`dispatch`.** Call `subagent_<agent>` with exactly `message`, then run `result --run <RUN>`.
2. **`stop`.** Show the stop to the human as the Stops section describes, and wait for the human's move.

Done when: <!-- TODO -->

## Stops

Every stop carries `moves`, the human's moves from the current state with the effect of each. Show `moves` and `warnings` word for word, and run only a move the human chose, with the human's words. The shell asks the human to allow each `answer`, `gate`, and `transition`.

### questions

Read each file under `questions`, and show it whole. Command: `answer --run <RUN> --id <ID> --option <KEY|custom> --answer '<WORDS>'`.

<!-- TODO: how to sort the human's reply -->

### gate

Show `summary` and each file under `freezes`. Commands: `gate gate --run <RUN> --decision approved [--note '<WORDS>']`, or `gate gate --run <RUN> --decision rejected --note '<WORDS>'`.

<!-- TODO: what the gate message shows -->

### blocked

Show `reason`, and the document it names. Command: `transition --run <RUN> --to <STATE> --note '<WORDS>'`, with a state from `moves`.

<!-- TODO: how to present each move -->

### status

<!-- TODO: what to report at `done` -->

## Output

<!-- TODO: the stop summary skeleton -->

## Constraints

- **CLI only.** Every state change goes through the CLI. Exit 2 is a refusal, and exit 1 is a malformed call.
- **Human moves.** Never run `answer`, `gate`, or `transition` without the human's words for it.
- <!-- TODO -->
