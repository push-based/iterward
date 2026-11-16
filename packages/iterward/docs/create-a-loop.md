# Create a loop of your own

A loop of your own starts as a copy of the default loop, which the package ships in `examples/default/`. For the files in that folder, see [The default loop](../examples/default/README.md).

## Change a copy of the default loop

To start a loop of your own from the default loop, follow these steps:

1. Copy the default loop to a directory of your repository, such as `loops/review/`, with `npx iterward init --to loops/review`.
2. In the copy, rename `default.loop.json`, and change `name`, `inputs`, `artifacts`, `steps`, `gates`, `stops`, `machine`, and `human`. For every field, see [Configuration](configuration.md).
3. In `hooks.mts`, change the hooks your loop needs, and add a hook for each guard, `onEnter`, or preflight the loop file names. The hooks import nothing from Iterward, so the copy works wherever it lives.
4. Run `npx iterward compile --config loops/review/review.loop.json`, and check each outcome's target it prints.
5. Change the agents in `agents/` to match your steps and their statuses. For each template and its placeholders, see [Default agents](../examples/default/agents/README.md).
6. Test the loop with `node:test`, as [Test a loop](testing.md) describes.

A run holds the sha256 of its loop file and hook modules, so start a new run after you edit either.

If a gate freezes an artifact that no step writes, such as a file a guard writes, declare a human move into that gate. No step rewrites such an artifact, so that move is how a human releases its freeze after the file changes.

## Design the loop with an agent

To have an agent draft the loop with you, give the agent the build-loop skill. An agent following the skill drafts the whole loop first, asks you one decision at a time with a recommended answer, and checks the result with `compile`. The agent gets the skill from the MCP server's `build-loop` tool, or from `npx iterward build-loop`, which prints the same text. To register the server, see [Set up the MCP server](mcp-setup.md).
