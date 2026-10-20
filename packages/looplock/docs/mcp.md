# MCP server

The MCP server exposes the CLI's commands as Model Context Protocol (MCP) tools, so an orchestrator can drive a run through tool calls instead of a shell. Each tool call runs one CLI command in its own process, so a tool refuses what the CLI refuses, and a changed loop file refuses the run as it does on the command line. The server needs no npm dependencies.

## Register the server

`looplock mcp` starts the server. The server runs each command in its working directory, so the client must start it in the root of the repository the loop works on.

To register the server with Claude Code, add it to the `.mcp.json` file in the repository root. The following entry runs the published package through npx, so the repository needs no install:

```json
{
    "mcpServers": {
        "looplock": { "command": "npx", "args": ["-y", "@push-based/looplock@VERSION", "mcp"] }
    }
}
```

Replace `VERSION` with the Looplock version your runs use, such as `0.4.0`. An engine of another minor version refuses a run, so a pinned version keeps every session on the engine that started the run. When the repository installs that version, npx runs the installed copy. In a clone of the Looplock repository, run `node packages/looplock/bin.ts mcp`, which Node.js runs without a build step.

The first start through npx downloads the package. If the client stops waiting before the download ends, restart the server after the download, or install the package.

A client that approves tool calls automatically, such as through an `autoApprove` list, must list only the machine moves and the loop tools: `init`, `build-loop`, `compile`, `new`, `next`, `result`, `validate`, and `show`. The client then asks the human to allow each `answer`, `gate`, and `transition`, the human moves Looplock records. One `answer` call carries every answer of one human message, so the human allows the answers once. When the client offers to always allow one of these three tools, decline, because an always-allowed tool runs without asking the human.

## Tools and arguments

The server has 11 tools, one for each command except `dispatch`, `mcp`, and `--version`. Each tool takes its command's flags as arguments:

| Tool | Arguments |
| --- | --- |
| `init` | Optionally `to`, the folder to copy the default loop to, `loops/default` when left out |
| `build-loop` | None |
| `compile` | `config` |
| `new` | `config`, `run`, and `inputs`, the loop inputs as one object, such as `{"subject": "the settings page"}` |
| `next` | `run` |
| `result` | `run`, and optionally `id`, the dispatch the call closes, from `next` |
| `show` | `run` |
| `validate` | `artifact` and `run` |
| `answer` | `run` and `answers`, a list with one `{ id, option, answer }` object for each question the human answered, at least 1 |
| `gate` | `gate`, `run`, `decision`, and `note` |
| `transition` | `run`, `to`, and `note` |

`build-loop`, `compile`, and `show` carry `readOnlyHint: true`. `compile` imports the loop's hook modules and calls no hook. `next` opens dispatches, and `validate` runs guards, which can write files. For each command, see [CLI reference](cli.md).

The server has no tool for `dispatch`, because a harness's watcher reads the open dispatch through the CLI.

A tool returns the command's output as text. A refusal returns an error result whose text starts with the tool name and `refused:`. A malformed call, such as a missing or unknown argument, returns one whose text starts with the tool name and `malformed call:`. An error text names each argument of the tool as the tool takes it, such as `note`, where the CLI prints the flag `--note`. Text in backticks, such as a command a guard quotes, stays as the CLI prints it. An argument the server can't pass to the CLI, such as one with a NUL character or one past the system's length limit, returns a malformed call.

The server handles one request at a time. Across processes, such as the server and a watcher that runs the CLI, the run's lock lets one command change the run at a time, and a command refused by the lock comes back as a refusal. For the lock, see [One command at a time](cli.md#one-command-at-a-time).

Set the client's request timeout above the longest hook. A `result` or a `transition` waits for every guard and `onEnter` hook it runs. The server doesn't cancel a command, so a call the client gave up on still finishes and changes the run. Pass `id` to `result`: a call retried after a timeout then refuses, instead of closing the dispatch the first call opened.

## Design a loop

`build-loop` returns the build-loop skill: instructions to interview the user about a workflow, settle one decision at a time, and write a loop file and its hooks module that `compile` accepts. The loop file reference and the hooks template follow the instructions, each after a line that names its file. The skill comes from the server's own package, so it matches the engine that compiles the loop. The server's `initialize` result carries instructions that tell an agent to call `build-loop` before it writes or changes a loop file. Without MCP, `npx looplock build-loop` prints the same text.
