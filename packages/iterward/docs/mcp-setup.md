# Set up the MCP server

The MCP server lets an orchestrator drive a run through tool calls instead of a shell. For the tools and their arguments, see [MCP server](mcp.md).

## Register the server

`iterward mcp` starts the server. The server runs each command in its working directory, so the client must start it in the root of the repository the loop works on.

To register the server with Claude Code, add it to the `.mcp.json` file in the repository root. The following entry runs the published package through npx, so the repository needs no install:

```json
{
    "mcpServers": {
        "iterward": { "command": "npx", "args": ["-y", "@push-based/iterward@latest", "mcp"] }
    }
}
```

The first start through npx downloads the package. If the client stops waiting before the download ends, restart the server after the download, or install the package.

In a clone of the Iterward repository, run `node packages/iterward/bin.ts mcp`, which Node.js runs without a build step.

## Pin the engine version

An engine of another minor version refuses a run, so after a minor release, `@latest` refuses a run that an earlier minor version started. The refusal names the command that continues the run, such as `npx @push-based/iterward@0.4`. To keep every session on the engine that started the run, replace `latest` with that version, such as `0.4.2`. When the repository installs that version, npx runs the installed copy.

## Keep the human moves behind an approval

A client that approves tool calls automatically, such as through an `autoApprove` list, must list only the machine moves and the loop tools: `init`, `build-loop`, `compile`, `new`, `next`, `result`, `validate`, `show`, and `dispatch`. The client then asks the human to allow each `answer`, `gate`, and `transition`, the human moves Iterward records. One `answer` call carries every answer of one human message, so the human allows the answers once. When the client offers to always allow one of these three tools, decline, because an always-allowed tool runs without asking the human.

## Set the request timeout

Set the client's request timeout above the longest hook, because a `result` or a `transition` waits for every guard and `onEnter` hook it runs. Pass `id` to `result`: a call retried after a timeout then refuses, instead of closing the dispatch the first call opened. For what the server does with a call the client gave up on, see [Tools and arguments](mcp.md#tools-and-arguments).
