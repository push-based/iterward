# Default agents

These agent skeletons run the loop in `presets/default.mts`. The orchestrator drives the `looplock` CLI, and the three sub-agents match the preset's `dispatches`. The following table maps each file to the status that dispatches it and the result statuses the preset accepts:

| File | Agent | Dispatched at | Result statuses |
| --- | --- | --- | --- |
| `default-orchestrator.md` | `default-orchestrator` | Started by the human | None |
| `planner.md` | `planner` | `plan` | `ok`, `needs-decisions` |
| `builder.md` | `builder` | `build` | `ok`, `blocked` |
| `verifier.md` | `verifier` | `verify` | `pass`, `fail`, `plan-invalidated`, `blocked` |

Each skeleton fills in what the preset and the CLI fix: the dispatch messages, the result statuses and their required fields, and the CLI commands each agent can run. Each `<!-- TODO: … -->` comment marks domain logic for you to write.

Before you use the agents, replace these placeholders in every file:

- `<LOOPLOCK_DIR>`: the directory that holds `bin.mts`, relative to the repository root.
- `<RUNS_DIR>`: the directory that holds one directory per run.
- `<AGENTS_DIR>`: the directory that holds these agent files.
- `<SOURCE_DIR>`: the source that the orchestrator, the planner, and the verifier never write.
- `<BUILD_COMMAND>` and `<CHECK_COMMAND>`: the shell commands that the builder and the verifier run.
- `<WELCOME_MESSAGE>`: the line each agent shows when it starts.
- `<RESOURCE_PATH>`: the files each agent loads into its context. Delete the `resources` entry when an agent needs none.
