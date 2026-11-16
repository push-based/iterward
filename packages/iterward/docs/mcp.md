# MCP server

The MCP server exposes the CLI's commands as Model Context Protocol (MCP) tools, so an orchestrator can drive a run through tool calls instead of a shell. Each tool call runs one CLI command in its own process, so a tool refuses what the CLI refuses, and a changed loop file refuses the run as it does on the command line. The server needs no npm dependencies.

`iterward mcp` starts the server. To register it with a client, see [Set up the MCP server](mcp-setup.md).

## Tools and arguments

The server has 12 tools, one for each command except `mcp` and `--version`. Each tool takes its command's flags as arguments:

| Tool | Arguments |
| --- | --- |
| `init` | Optionally `to`, the folder to copy the default loop to, `loops/default` when left out |
| `build-loop` | None |
| `compile` | `config` |
| `new` | `config`, `run`, and `inputs`, the loop inputs as one object, such as `{"subject": "the settings page"}` |
| `next` | `run` |
| `result` | `run`, and optionally `id`, the dispatch the call closes, from `next` |
| `show` | `run` |
| `dispatch` | `run` |
| `validate` | `artifact` and `run` |
| `answer` | `run` and `answers`, a list with one `{ id, option, answer }` object for each question the human answered, at least 1 |
| `gate` | `gate`, `run`, `decision`, and `note` |
| `transition` | `run`, `to`, and `note` |

`build-loop`, `compile`, `show`, and `dispatch` carry `readOnlyHint: true`. `compile` imports the loop's hook modules and calls no hook. `next` opens dispatches, and `validate` runs guards, which can write files. For each command, see [CLI reference](cli.md).

`dispatch` returns the open dispatch, `{ id, step, agent, attempt, document, openedAt, message }`, with `message` byte for byte as `next` returned it. It takes no lock, writes nothing, and refuses when no dispatch is open for the run. To hand a dispatch to a background agent, see [Launch an agent in the background](background-agents.md).

A tool returns the command's output as text. A refusal returns an error result whose text starts with the tool name and `refused:`. A malformed call, such as a missing or unknown argument, returns one whose text starts with the tool name and `malformed call:`. An error text names each argument of the tool as the tool takes it, such as `note`, where the CLI prints the flag `--note`. Text in backticks, such as a command a guard quotes, stays as the CLI prints it. An argument the server can't pass to the CLI, such as one with a NUL character or one past the system's length limit, returns a malformed call.

The server handles one request at a time. Across processes, such as the server and a watcher that runs the CLI, the run's lock lets one command change the run at a time, and a command refused by the lock comes back as a refusal. For the lock, see [One command at a time](cli.md#one-command-at-a-time).

A `result` or a `transition` waits for every guard and `onEnter` hook it runs. The server doesn't cancel a command, so a call the client gave up on still finishes and changes the run. A `result` call that carries `id` and is retried after a timeout refuses, instead of closing the dispatch the first call opened. To set the timeout, see [Set the request timeout](mcp-setup.md#set-the-request-timeout).

## The build-loop tool

`build-loop` returns the build-loop skill: instructions to interview the user about a workflow, settle one decision at a time, and write a loop file and its hooks module that `compile` accepts. The loop file reference and the hooks template follow the instructions, each after a line that names its file. The skill comes from the server's own package, so it matches the engine that compiles the loop. The server's `initialize` result carries instructions that tell an agent to call `build-loop` before it writes or changes a loop file. Without MCP, `npx iterward build-loop` prints the same text.
