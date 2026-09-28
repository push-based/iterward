# MCP server

The MCP server exposes the CLI's commands as Model Context Protocol (MCP) tools, so an orchestrator can drive a run through tool calls instead of a shell. Each tool call runs one CLI command in its own process, so a tool refuses what the CLI refuses, and a changed loop file refuses the run as it does on the command line. The server needs no npm dependencies.

## Register the server

The server runs each command in its working directory, so the client must start it in the root of the repository the loop works on. The server's path depends on the copy you run:

- In a built copy, the server is `mcp/server.mjs`.
- In the repository, the server is `mcp/server.mts`, which Node.js runs without a build step.

To register a built copy with Claude Code, add it to the `.mcp.json` file in the repository root:

```json
{
    "mcpServers": {
        "looplock": { "command": "node", "args": ["LOOPLOCK_DIR/mcp/server.mjs"] }
    }
}
```

Replace `LOOPLOCK_DIR` with the directory of the copy.

A client that approves tool calls automatically, such as through an `autoApprove` list, must list only the machine moves: `new`, `next`, `result`, `validate`, and `show`. The client then asks the human to allow each `answer`, `gate`, and `transition`, the human moves Looplock records. One `answer` call carries every answer of one human message, so the human allows the answers once. When the client offers to always allow one of these three tools, decline, because an always-allowed tool runs without asking the human.

## Tools and arguments

The server has 8 tools, one for each command except `compile` and `--version`. Each tool takes its command's flags as arguments:

| Tool | Arguments |
| --- | --- |
| `new` | `config`, `run`, and `inputs`, the loop inputs as one object, such as `{"subject": "the settings page"}` |
| `next` | `run` |
| `result` | `run` |
| `show` | `run` |
| `validate` | `artifact` and `run` |
| `answer` | `run` and `answers`, a list with one `{ id, option, answer }` object for each question the human answered, at least 1 |
| `gate` | `gate`, `run`, `decision`, and `note` |
| `transition` | `run`, `to`, and `note` |

Only `show` carries `readOnlyHint: true`. `next` opens dispatches, and `validate` runs guards, which can write files. For each command, see [CLI reference](cli.md).

The server has no tool for `compile`, because an agent that drives a run doesn't need the compiled loop. To review it, run the `compile` command of the CLI.

A tool returns the command's output as text. A refusal returns an error result whose text starts with the tool name and `refused:`. A malformed call, such as a missing or unknown argument, returns one whose text starts with the tool name and `malformed call:`. An error text names each argument as the tool takes it, such as `note`, where the CLI prints the flag `--note`.

The server handles one request at a time, so two tool calls on one run never interleave their reads and writes of the run file.

Set the client's request timeout above the longest hook. A `result` or a `transition` waits for every guard and validator it runs. The server doesn't cancel a command, so a call the client gave up on still finishes and changes the run.
