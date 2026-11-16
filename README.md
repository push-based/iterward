<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/iterward-logo-dark.png">
    <img src="assets/iterward-logo.png" alt="Iterward" width="320">
  </picture>
</h1>

[![npm](https://img.shields.io/npm/v/@push-based/iterward)](https://www.npmjs.com/package/@push-based/iterward)

LLMs do the work. Iterward decides what happens next.

Iterward is a deterministic control plane for agentic engineering workflows. It moves routing, retries, approvals, failures, and stop conditions out of prompts and into a loop file and code that you can test. Agents own execution, and Iterward owns protocol: a run moves only along the transitions its loop file declares, and Iterward records every human move.

Iterward closes the loop around your agents. In a closed-loop agent workflow, each result decides the next step: a failed verification sends the work back to the builder, a gate holds the run until a human approves, and a limit parks the run after too many attempts. Iterward makes those decisions from the loop file, so your agents don't have to.

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
        "iterward": { "command": "npx", "args": ["-y", "@push-based/iterward@latest", "mcp"] }
    }
}
```

To keep a run on the version that started it, see [Pin the engine version](packages/iterward/docs/mcp-setup.md#pin-the-engine-version). The server's `build-loop` tool gives an agent the build-loop skill, which interviews you about a workflow and writes a loop file that compiles.

## Documentation

The following pages cover the rest:

- [Iterward](packages/iterward/README.md): the problem, how Iterward works, a loop in code, and what the engine enforces.
- [Run the default loop by hand](packages/iterward/docs/tutorial.md): play every agent and take a run to `done`.
- [Create a loop of your own](packages/iterward/docs/create-a-loop.md): change a copy of the default loop, or design a loop with an agent.
- [Set up the MCP server](packages/iterward/docs/mcp-setup.md): register the server, and pin the engine version.
- [Configuration](packages/iterward/docs/configuration.md): the loop file, its hooks, and the standard message.
- [CLI reference](packages/iterward/docs/cli.md): the commands, their flags, and the exit codes.
- [MCP server](packages/iterward/docs/mcp.md): the tools, their arguments, and their results.
- [Protocol rules](packages/iterward/docs/protocol.md): the promise, the terms, and the rules.
- [Test a loop](packages/iterward/docs/testing.md): test a loop with `node:test`.

## Develop

The repository is an Nx workspace with two projects: the package in `packages/iterward`, and the documentation site in `website`, which renders the package's Markdown files with Docusaurus. To build and test both, install the workspace, and run the targets through Nx:

```bash
npm install
npx nx run-many -t build test
```

To preview the documentation site at `http://localhost:3000/iterward/`, run `npm run start -w website`.

To run only the engine's tests, run `npm test` in the `packages/iterward` folder. Two of those tests guard the package itself:

- The test in `mcp/spec/conformance.spec.ts` drives the MCP server with the official client of `@modelcontextprotocol/sdk`, which checks every reply against the protocol's schemas. The SDK is a development dependency only, so the package still installs no dependencies.
- One test in `engine.spec.ts` keeps the package domain independent. It scans every file of the package, the specs and their fixtures included, for terms from the workflow Iterward came from, and fails on a match. Put a loop for a specific domain in its own directory, outside this repository.

Every commit follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). A `commit-msg` hook, which `npm install` sets up, checks each message.

## License

Iterward is available under the [MIT License](LICENSE).
