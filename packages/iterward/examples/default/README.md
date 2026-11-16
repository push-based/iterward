# The default loop

This folder is a complete loop to run and to copy: a planner writes a plan, a human approves it at the gate, a builder implements it, and a verifier judges the build. The Iterward package ships the folder, but the engine never loads it.

## Files

The folder holds these files:

- `default.loop.json`: the loop file, `plan → gate → build → verify → done`. It names the inputs, the artifacts, the steps with their outcomes, the gate, the stop, the machine, the human moves, and the hooks.
- `hooks.mts`: the three hooks the loop file names, with no dependency. `statusGuard` returns the `status:` line of a document's frontmatter. `planGuard` refuses a `plan.md` without `id` and `status` in its frontmatter, and returns its status otherwise. `onAnswer` writes `status`, `chosen`, and `answer` into a question file's frontmatter, through a temporary file and a rename.
- `default.spec.mts`: the loop end to end, through the CLI. `iterward init` doesn't copy it, because it runs the CLI of the Iterward package.
- `agents/`: agent templates for the orchestrator, the planner, the builder, and the verifier. For each file and its placeholders, see [Default agents](agents/README.md).

To run the loop by hand, see [Run the default loop by hand](../../docs/tutorial.md). To start a loop of your own from this folder, see [Create a loop of your own](../../docs/create-a-loop.md).
