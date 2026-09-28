# The default loop

This folder is a complete loop to run and to copy: a planner writes a plan, a human approves it at the gate, a builder implements it, and a verifier judges the build. It isn't part of the Looplock package.

## Files

The folder holds these files:

- `default.loop.json`: the loop file, `plan → gate → build → verify → done`. It names the inputs, the artifacts, the steps with their outcomes, the gate, the stop, the machine, the human moves, and the hooks.
- `hooks.mts`: the three hooks the loop file names, with no dependency. `statusGuard` returns the `status:` line of a document's frontmatter. `planGuard` refuses a `plan.md` without `id` and `status` in its frontmatter, and returns its status otherwise. `onAnswer` writes `status`, `chosen`, and `answer` into a question file's frontmatter, through a temporary file and a rename.
- `default.spec.mts`: the loop end to end, through the CLI.
- `agents/`: agent templates for the orchestrator, the planner, the builder, and the verifier. For each file and its placeholders, see [Default agents](agents/README.md).

To run the loop by hand, see [Run the default loop by hand](../../docs/tutorial.md).

## Make a loop of your own

To start a loop of your own from this folder, follow these steps:

1. Copy the folder to a directory outside the Looplock repository, such as `loops/review/`.
2. In the copy, rename `default.loop.json`, and change `name`, `inputs`, `artifacts`, `steps`, `gates`, `stops`, `machine`, and `human`. For every field, see [Configuration](../../docs/configuration.md).
3. In `hooks.mts`, change the hooks your loop needs, and add a hook for each guard, `onEnter`, or preflight the loop file names. The hooks import nothing from Looplock, so the copy works wherever it lives.
4. Run `node LOOPLOCK_DIR/bin.mts compile --config loops/review/review.loop.json`, and check each outcome's target it prints. Replace `LOOPLOCK_DIR` with the directory of your Looplock copy.
5. Change the agents in `agents/` to match your steps and their statuses.
6. In `default.spec.mts`, change `BIN` to your Looplock copy and `LOOP` to your loop file, and change the steps to your loop's path to its terminal stop.

A run holds the sha256 of its loop file and hook modules, so start a new run after you edit either.
