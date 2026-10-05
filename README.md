# Looplock

LLMs do the work. Looplock decides what happens next.

Looplock is a deterministic control plane for agentic engineering workflows. It moves routing, retries, approvals, failures, and stop conditions out of prompts and into a loop file and code that you can test.

## The problem

A multi-agent workflow often keeps its control logic in prose: orchestration prompts, instructions in `AGENTS.md` files and agent definitions, conventions about which agent runs next, and ad hoc retry limits. This works for simple happy paths. It gets much harder to reason about once the workflow has to support human decisions, retries, partial failures, invalidated work, and resumed runs.

At that point the workflow is a state machine, implemented partly in natural language. The LLM does the work, and you also ask it to remember and enforce the protocol that governs the work. The more important the workflow becomes, the less you want to rely on that.

Consider a dependency remediation workflow: discover the dependency, analyze its reachability, propose a fix, get a security approval, implement the fix, run the tests, and verify that the vulnerability is gone. An LLM can do most of those steps. Don't let it decide whether the approval can be skipped, whether a failed verification can be ignored, or whether the run has retried too many times. A loop file makes those decisions instead: the run can't reach the implementation without the approval, a failed verification sends the run back to the implementation, and a limit parks the run after too many failures.

## How Looplock works

Agents own execution. Looplock owns protocol. A dispatch can go to Claude Code, Codex, a custom MCP agent, a CI process, or a human, and Looplock handles each the same way: it needs a dispatch message and a document with a status.

Your orchestrator drives the loop with two calls, plus one command for each human move. `next` prints the move the run needs. `result` hands the document the agent wrote to its guard, which returns the status, and follows the loop's machine to the status's target. The following diagram shows one dispatch and one human stop:

```mermaid
sequenceDiagram
    actor Human
    participant O as Orchestrator
    participant L as looplock
    participant A as Agent
    O->>L: next
    L-->>O: dispatch (agent, message)
    O->>A: message
    A->>A: Do the work, write the document
    A-->>O: Reply for the human
    O->>L: result
    L->>L: Read the status through the guard, follow the machine
    L-->>O: Next dispatch, or a stop with the human's moves
    O->>Human: Stop summary and moves
    Human-->>O: Answer, gate decision, or transition
    O->>L: answer, gate, or transition
```

The `looplock` CLI keeps each run's state in a `run.json` file and refuses any move the loop doesn't declare. The orchestrator doesn't interpret routing instructions: it carries each message to its agent and each result back to the CLI, and it can be an agent, a script, or you at a terminal. A sub-agent doesn't need the orchestration graph either. It receives one task, performs it, and writes one document whose frontmatter carries its status. The agent can still write a human-readable reply, but Looplock reads only the document, and only through your hooks.

## A loop in code

A loop is one JSON file: its inputs, its artifacts, its steps, gates, and stops, and `machine`, the target of each outcome. Each condition the engine can't know, such as how to read a document's status or whether a plan is complete, is a hook: a named export of an ES module beside the loop file, named as `"<file>#<export>"`. The following listing is `examples/default/default.loop.json`:

```json
{
  "name": "default",
  "inputs": { "required": ["subject"] },
  "questions": { "file": "Q-{n}.md", "onAnswer": "./hooks.mts#onAnswer" },
  "artifacts": {
    "plan": { "file": "plan.md", "guard": "./hooks.mts#planGuard" },
    "build-report": { "file": "build.{attempt}.md", "guard": "./hooks.mts#statusGuard" },
    "verify-report": { "file": "verify.{attempt}.md", "guard": "./hooks.mts#statusGuard" }
  },
  "steps": {
    "plan": { "agent": "planner", "writes": "plan", "outcomes": ["ok", "needs-decisions", "blocked"] },
    "build": { "agent": "builder", "writes": "build-report", "outcomes": ["ok", "blocked"] },
    "verify": { "agent": "verifier", "writes": "verify-report", "outcomes": ["pass", "fail", "blocked"] }
  },
  "gates": { "gate": { "label": "Gate", "freezes": ["plan"] } },
  "stops": { "done": {} },
  "machine": {
    "start": "plan",
    "plan.ok": "gate",
    "plan.needs-decisions": { "ask": "plan" },
    "gate.approve": "build",
    "gate.reject": "plan",
    "build.ok": "verify",
    "verify.pass": "done",
    "verify.fail": "build",
    "*.blocked": "park"
  },
  "human": { "build": ["plan"], "verify": ["plan", "build"] },
  "limits": { "opens": 3 }
}
```

Each step declares the statuses its document can carry, and `machine` maps each one to a target: a step, a gate, a stop, `park`, or `{ "ask": STEP }`, which stops on the human's questions and then opens the step. `"*.blocked"` covers every step that declares `blocked`. A gate is left only by a decision, `gate.approve` or `gate.reject`, and `human` lists the moves a human can make from each step. Nothing is inferred: `compile` refuses a declared outcome with no target and a target that names no state.

The hooks are plain functions that import nothing from Looplock. The guard in `hooks.mts`, shown here without its types, returns a document's status, which `machine` follows:

```ts
export function statusGuard(path) {
    const status = frontmatter(path)?.status;
    return status ? { status } : { errors: [`${basename(path)} § frontmatter: no status`] };
}
```

To print the compiled loop, each outcome resolved to its target, run `node bin.mts compile --config examples/default/default.loop.json`. For every field, see [Configuration](docs/configuration.md).

## Scope

Looplock isn't an agent framework. It never starts an agent: `next` prints the dispatch, and your runtime runs it. It doesn't decide how an agent reasons, which model it uses, or how it edits code. It never parses your documents: it hashes files for freezes, compares a document's modification time with its dispatch, lists question files by name, and hands every path to a hook. It also isn't a durable execution platform such as Temporal: it has no distributed scheduling, queues, cloud execution, model hosting, or agent memory.

The package holds only the engine, the CLI, and the MCP server. The default loop in `examples/default/` is a starting point to copy, not part of the package.

Its scope is small on purpose. Looplock fits workflows where agents or humans do the work, where failures and approvals matter, and where the protocol matters enough to formalize, inspect, and test.

## What the engine enforces

Looplock makes one promise:

> Looplock guarantees that a run moves only along the transitions its loop declares, and it records every human move. It doesn't judge a verdict or prove who made a move: the consumer's guards and entry checks guard honest verdicts, and the MCP client authorizes each human move interactively. A consumer's preflight can refuse the client configurations it knows to approve human moves automatically. Neither the engine nor a consumer can prove that a human clicked.

The engine checks the run file on every call. These rules hold for every loop:

- **Valid transitions.** A run moves only along `machine`, a gate's decisions, and the human moves the loop lists, and a state's `onEnter` runs on every transition into it.
- **Gate approvals and freezes.** A run leaves a gate forward only after a human approves it. The approval freezes the files the gate names. A changed frozen file stops the run until a human moves it into a step that rewrites the frozen artifact, which drops the freeze.
- **Declared human moves.** A human moves with `transition` only along the moves the loop lists for the current state. Every stop lists the human's moves as data: the call that records each move, and what the call changes.
- **Answers, all or none.** An `answer` call records all of its answers or none of them. For each answer, the call runs the loop's `onAnswer` hook, then freezes the question file.
- **Bounded opens.** An unusable or refused result opens the same step again with the lines to fix, and a step opened `limits.opens` times since the last human move parks the run for a human.
- **One command at a time.** A command that changes a run holds the run's lock, so a second one is refused before any hook runs. The engine replaces `run.json` whole.

For every rule and the terms it uses, see [Protocol rules](docs/protocol.md).

## Quick start

You need Node.js 22.18 or later. Looplock has no npm dependencies, and development has no build step. Clone the repository, run the tests, and start a run of the default loop:

```bash
git clone https://github.com/push-based/looplock.git
cd looplock
node --test '**/*.spec.mts'
node bin.mts new --config examples/default/default.loop.json --run runs/example/run.json --subject 'the settings page'
node bin.mts next --run runs/example/run.json
```

`next` prints the first dispatch, the planner's standard message:

```json
{"do":"dispatch","id":1,"agent":"planner","message":"Step: plan\nRun: runs/example/run.json\nDocument: runs/example/plan.md\nInputs:\n  subject: the settings page\nNote: none\nFixes: none"}
```

To play each agent by hand through the gate, the build, and the verification, continue with [Run the default loop by hand](docs/tutorial.md). To start a loop of your own, copy `examples/default/`, as [The default loop](examples/default/README.md) describes.

## Documentation

The following pages cover the rest:

- [Run the default loop by hand](docs/tutorial.md): play every agent and take a run to `done`.
- [Protocol rules](docs/protocol.md): the promise, the terms, and the rules.
- [Configuration](docs/configuration.md): the loop file, artifacts, steps, gates, stops, the machine, human moves, limits, the standard message, and hooks.
- [CLI reference](docs/cli.md): the commands, their flags, and the exit codes.
- [MCP server](docs/mcp.md): drive a run through MCP tool calls.
- [The default loop](examples/default/README.md): the example loop, its hooks, and its agent templates.
- [Testing](docs/testing.md): test a loop with `node:test`, and run the engine's tests.
- [Run format](docs/run-format.md): the files a run writes.
