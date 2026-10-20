<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/iterward-logo-dark.png">
    <img src="assets/iterward-logo.png" alt="Iterward" width="320">
  </picture>
</h1>

[![npm](https://img.shields.io/npm/v/@push-based/iterward)](https://www.npmjs.com/package/@push-based/iterward)

LLMs do the work. Iterward decides what happens next.

Iterward is a deterministic control plane for agentic engineering workflows. It moves routing, retries, approvals, failures, and stop conditions out of prompts and into a loop file and code that you can test. Agents own execution, and Iterward owns protocol: a run moves only along the transitions its loop file declares, and Iterward records every human move.

## Get started

Iterward needs Node.js 22.18 or later and has no npm dependencies. To copy the default loop into your repository and start a run, run these commands from the repository root:

```bash
npx @push-based/iterward init
npx @push-based/iterward new --config loops/default/default.loop.json --run runs/example/run.json --subject 'the settings page'
npx @push-based/iterward next --run runs/example/run.json
```

`next` prints the first dispatch: the message for the planner agent. To install Iterward as a development dependency instead, see [Install](packages/iterward/README.md#install).

## Use it from an agent

The MCP server exposes the CLI's commands as tools. To register it with Claude Code, add it to the `.mcp.json` file in your repository root:

```json
{
    "mcpServers": {
        "iterward": { "command": "npx", "args": ["-y", "@push-based/iterward@VERSION", "mcp"] }
    }
}
```

Replace `VERSION` with the Iterward version your runs use, such as `0.4.0`. The server's `build-loop` tool gives an agent the build-loop skill, which interviews you about a workflow and writes a loop file that compiles.

## Documentation

The following pages cover the rest:

- [Iterward](packages/iterward/README.md): the problem, how Iterward works, a loop in code, and what the engine enforces.
- [Run the default loop by hand](packages/iterward/docs/tutorial.md): play every agent and take a run to `done`.
- [Configuration](packages/iterward/docs/configuration.md): the loop file, its hooks, and the standard message.
- [CLI reference](packages/iterward/docs/cli.md): the commands, their flags, and the exit codes.
- [MCP server](packages/iterward/docs/mcp.md): drive a run and design a loop through MCP tool calls.
- [Protocol rules](packages/iterward/docs/protocol.md): the promise, the terms, and the rules.
- [Testing](packages/iterward/docs/testing.md): test a loop with `node:test`.

## Develop

The repository is an Nx workspace with one package, `packages/iterward`. To build and test it, install the workspace, and run the targets through Nx:

```bash
npm install
npx nx run-many -t build test
```

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). A `commit-msg` hook, which `npm install` sets up, checks each message.

## License

Iterward is available under the [MIT License](LICENSE).
