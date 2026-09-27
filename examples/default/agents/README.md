# Default agents

These agent templates run the loop in `default.loop.json`. The orchestrator drives the `looplock` CLI, and the three sub-agents match the loop's dispatches: `planner`, `build`, and `verify`. Each sub-agent writes one document per dispatch, and the document's frontmatter carries its `id` and its status. The following table maps each file to the state that dispatches it, the document it writes, and the statuses the loop accepts:

| File | Agent | Dispatched at | Document | Statuses |
| --- | --- | --- | --- | --- |
| `orchestrator.md` | `orchestrator` | Started by the human | None | None |
| `planner.md` | `planner` | `plan` | `plan.md`, and a `Q-<N>.md` file for each question | `ok`, `needs-decisions`, `blocked` |
| `builder.md` | `builder` | `build` | `build.<N>.md`, which the message names | `ok`, `blocked` |
| `verifier.md` | `verifier` | `verify` | `verify.<N>.md`, which the message names | `pass`, `fail`, `blocked` |

Each template fills in what the loop and the CLI fix: the dispatch messages, the documents and their statuses, and the CLI commands each agent can run. Each `<!-- TODO: … -->` comment marks domain logic for you to write.

Before you use the agents, replace these placeholders in every file:

- `<LOOPLOCK_DIR>`: the directory that holds `bin.mts`, or `bin.mjs` in a built copy, relative to the repository root.
- `<LOOP_DIR>`: the directory that holds `default.loop.json`.
- `<RUNS_DIR>`: the directory that holds one directory per run.
- `<AGENTS_DIR>`: the directory that holds these agent files.
- `<SOURCE_DIR>`: the source that the orchestrator, the planner, and the verifier never write.
- `<BUILD_COMMAND>` and `<CHECK_COMMAND>`: the shell commands that the builder and the verifier run.
- `<WELCOME_MESSAGE>`: the line each agent shows when it starts.
- `<RESOURCE_PATH>`: the files each agent loads into its context. Delete the `resources` entry when an agent needs none.
