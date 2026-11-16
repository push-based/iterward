# Launch an agent in the background

If your orchestrator launches an agent in the background, such as with a workflow tool that returns before the agent ends, have the agent read its own message with `dispatch`. An orchestrator that launches before `next` returns sends a guessed message. A guessed message drops the `Fixes:` lines, which carry the guard errors that only Iterward holds.

To launch the agent, have the orchestrator follow these steps:

1. Call `next`, so the dispatch is open when the agent reads it.
2. Launch the agent with only the run path, such as `Run: runs/example/run.json`. Don't copy the message from `next` into the launch.
3. Have the agent call `dispatch` to read its message, and then follow the message.
4. After the agent writes its document, call `result`.

For what `dispatch` returns, see [Tools and arguments](mcp.md#tools-and-arguments).
