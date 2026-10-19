# Looplock

LLMs do the work. Looplock decides what happens next.

Looplock is a deterministic control plane for agentic engineering workflows. It moves routing, retries, approvals, failures, and stop conditions out of prompts and into a loop file and code that you can test. Agents own execution, and Looplock owns protocol: a run moves only along the transitions its loop file declares, and Looplock records every human move.

## Get started

Looplock needs Node.js 22.18 or later and has no npm dependencies. To copy the default loop into your repository and start a run, run these commands from the repository root:

```bash
npx @push-based/looplock init
npx @push-based/looplock new --config loops/default/default.loop.json --run runs/example/run.json --subject 'the settings page'
npx @push-based/looplock next --run runs/example/run.json
```

`next` prints the first dispatch: the message for the planner agent. To install Looplock as a development dependency instead, see [Install](packages/looplock/README.md#install).

## Use it from an agent

The MCP server exposes the CLI's commands as tools. To register it with Claude Code, add it to the `.mcp.json` file in your repository root:

```json
{
    "mcpServers": {
        "looplock": { "command": "npx", "args": ["-y", "@push-based/looplock@VERSION", "mcp"] }
    }
}
```

Replace `VERSION` with the Looplock version your runs use, such as `0.4.0`. The server's `build-loop` tool gives an agent the build-loop skill, which interviews you about a workflow and writes a loop file that compiles.

## Documentation

The following pages cover the rest:

- [Looplock](packages/looplock/README.md): the problem, how Looplock works, a loop in code, and what the engine enforces.
- [Run the default loop by hand](packages/looplock/docs/tutorial.md): play every agent and take a run to `done`.
- [Configuration](packages/looplock/docs/configuration.md): the loop file, its hooks, and the standard message.
- [CLI reference](packages/looplock/docs/cli.md): the commands, their flags, and the exit codes.
- [MCP server](packages/looplock/docs/mcp.md): drive a run and design a loop through MCP tool calls.
- [Protocol rules](packages/looplock/docs/protocol.md): the promise, the terms, and the rules.
- [Testing](packages/looplock/docs/testing.md): test a loop with `node:test`.

## Develop

The repository is an Nx workspace with one package, `packages/looplock`. To build and test it, install the workspace, and run the targets through Nx:

```bash
npm install
npx nx run-many -t build test
```

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). A `commit-msg` hook, which `npm install` sets up, checks each message.

## License

Looplock is available under the [MIT License](LICENSE).
