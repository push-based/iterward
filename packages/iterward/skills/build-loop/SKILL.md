---
name: build-loop
description: Interview the user about a multi-agent workflow and write an Iterward loop file (`*.loop.json`) plus the `hooks.mts` it names, checked with `iterward compile`. Use whenever the user wants to create, design, draft, or sketch an Iterward loop, a loop file, a `.loop.json`, or a state machine of agent steps, gates, retries, and approvals for Iterward, even if they only describe the workflow ("planner, then builder, then verifier, with my approval before the build") and never say "loop file". Also use for "/build-loop" and "grill me into a loop". Not for running or driving an existing run (use the `iterward` CLI or MCP tools for that).
argument-hint: "The workflow in your own words, or nothing to start from a blank page"
---

# Build a loop

Turn a workflow the user has in their head into an Iterward loop file that compiles. The interview is a grilling session: you draft early, then resolve one decision at a time, each with a recommended answer, until the loop is fully specified. The only tangible output is the loop file and its hooks module, and both must pass `iterward compile` before you call the work done.

Why it works this way: a loop file is a state machine, and its value comes from declaring every outcome's target. A user describes the happy path and forgets the failures, the human decisions, and the retries. The grilling exists to surface those branches; the compiler exists to prove the result is a loop the engine can run.

Before the first question, read [references/loop-file.md](references/loop-file.md). It holds the schema, the semantics each design choice depends on, and every check the compiler runs. Don't draft from memory: the compiler refuses unknown fields and reserved names. If you received this skill from the `build-loop` tool or command, the reference and the hooks template follow these instructions, each after a line that names its file.

## Phase 1: Look up the facts

Find the facts yourself instead of asking for them:

- **The compiler.** Use the first that works: the `compile` tool of the Iterward MCP server, `npx iterward compile` when `node_modules/.bin/iterward` exists in the working directory, `node packages/iterward/bin.ts compile` in a clone of the Iterward repository (`node bin.ts compile` in its package folder), or `npx -y @push-based/iterward compile`. The tool takes the loop file as `config`, and each command takes it as `--config`.
- **Existing loops.** Search for `*.loop.json` and `hooks.mts` files. If the user is extending one, start the draft from it instead of a blank page.
- **Agents.** Look for agent definitions (`agents/*.md`, `.claude/agents/*.md`, `AGENTS.md`). Reuse their names as step agents so the loop matches what the orchestrator dispatches.

## Phase 2: Get the workflow in the user's words

If the invocation already describes the workflow, skip this question. Otherwise ask one open question: what goes in, who does each piece of work, where a human must decide or approve, and what "done" looks like. This is the only open question of the session; every later question offers options.

## Phase 3: Draft the whole loop

Propose a complete first draft right away, before the details are settled. A concrete draft is faster to correct than a series of abstract questions, and it shows the user the shape of what you build. Fill every gap with the recommendation from the defaults in this section, and mark each assumption.

Show the draft as:

1. A Mermaid `stateDiagram-v2` of the machine: every step, gate, and stop, with one labeled edge per outcome or decision, and `park` drawn as a state.
2. A short table of the steps: the step, its agent, the document it writes, and its outcomes.

Apply these defaults unless the user's description says otherwise:

- One step per piece of agent work, named as a lowercase noun or verb (`plan`, `build`, `verify`). One step writes one artifact.
- `ok` is the happy-path outcome. A step that judges something uses a verdict pair instead, such as `pass` and `fail`, or `approved` and `changes-requested`.
- Every step declares `blocked`, and `"*.blocked": "park"` sends all of them to a human. An agent that can't proceed must have a way to say so.
- A failed check goes back to the step that does the work (`verify.fail` → `build`), and `limits.opens` bounds that cycle.
- A human approval before expensive or irreversible work is a gate that freezes the document the human approved. A rejection goes back to the step that wrote it.
- An artifact frozen by a gate is a single file (`plan.md`). An artifact rewritten on every retry is per attempt (`build.{attempt}.md`), so each attempt's report stays.
- The run ends in a stop named `done` with no human moves.
- Guards read a `status:` line from the document's frontmatter, as `statusGuard` in the hooks template does.

## Phase 4: Grill, one decision at a time

Walk the decision tree in dependency order, and settle each branch before the ones that depend on it. Ask one question per message and wait for the answer: several questions at once are hard to answer well.

Present every decision as lettered options (A, B, C, and D at most), each with its consequence for the run, and put the recommended option first, marked as recommended. When the `AskUserQuestion` tool is available, use it with the same shape. Skip a question when the user already answered it, or when the schema forces the answer, and say which default you applied.

Cover these decisions, in this order:

1. **Inputs.** Which `--<INPUT>` flags every run needs (`required`), and which ones a run can leave out (`optional`).
2. **Steps and agents.** Confirm the step list and which agent runs each step. Two steps can share an agent and an artifact, such as a `draft` and a `revision` that both write `plan`.
3. **Outcomes.** For each step, the statuses its document can carry. Ask what can go wrong in that step: each distinct failure the orchestrator must route differently is its own outcome.
4. **Routing.** The target of each outcome that isn't the happy path: another step, a gate, a stop, `park`, or the human's questions.
5. **Questions.** Whether an agent can stop mid-step to ask the human for decisions. If so, the step declares an outcome such as `needs-decisions` that targets `{ "ask": STEP }`, and the loop declares `questions`. Ask which step runs after the answers.
6. **Gates.** Where a human must approve, which artifacts the approval freezes, and where a rejection goes.
7. **Stops and human moves.** Which stops the run can end in, and which earlier states a human can send the run back to from each step or stop (`human`). A stop with human moves isn't terminal.
8. **Limits.** How many opens of one step, since the last human move, before the run parks. The default is 3.
9. **Hooks.** How each guard reads the status, which states need an `onEnter` entry check (a check the engine runs before the run may enter), and whether `new` needs a `preflight`.
10. **Location.** Where to write the files. Recommend `loops/<NAME>/<NAME>.loop.json` with `hooks.mts` beside it.

After each answer, update the draft. When an answer changes the machine, show the updated diagram.

Before you leave this phase, check the machine yourself, because the compiler doesn't:

- Every state is reachable from `start`.
- From every step, some path reaches a terminal stop or `park`.
- Every cycle passes through a step, so `limits.opens` can bound it.
- Every gate freezes at least the document the human judges, unless the user chose otherwise.

Raise each problem as its own question.

## Phase 5: Confirm, then write

Show the final diagram and the complete loop file, and ask the user to confirm it before you write anything. Don't write files until the user confirms that you share one understanding of the loop.

After the user confirms:

1. If a target file exists, show what differs and ask before you replace it.
2. Write the loop file. Use two-space indentation, keep each step, artifact, and gate on one line as `examples/default/default.loop.json` does, and order the top-level fields as the schema lists them.
3. Write `hooks.mts` from [assets/hooks.mts](assets/hooks.mts). Keep only the exports the loop names, and add each other hook the loop names with the signature in the template's comments. A stub returns the value that accepts (`[]` for `onEnter`, no errors for `preflight`), and says so in a comment so the user knows what to fill in.
4. Compile the loop file with the compiler from phase 1. If it refuses the file, the message names the place at fault: fix the file and run it again. Don't change the user's decisions to make it compile; if a decision can't compile, ask again with the reason.
5. Read the compiled output, and check that each step's outcomes resolve to the targets the user chose.

## Phase 6: Report

End with:

- The paths of the files you wrote.
- The final diagram.
- Each hook stub the user must fill in, and what it must check.
- The command that starts a run, with every required input, such as `npx iterward new --config loops/review/review.loop.json --run runs/1/run.json --subject 'the settings page'`.
