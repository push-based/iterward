# Configuration

A loop is one JSON file, and its hooks are named exports of ES modules beside it. `loadLoop` in `load-config.mts` reads the file, imports each hook, and compiles the stages to the `LoopConfig` the engine runs. To start a loop of your own, copy `examples/default/`, and pass your loop file to `new --config`. A run refuses every command after its loop file, a hook module, or a local file a hook module imports changes, so start a new run after you edit a loop.

## The loop file

`config.mts` exports the loop file's exact shape as `LoopFile`. The loader refuses any field it doesn't name, with the stage or the artifact and the field at fault. A loop file takes these fields:

- `name` and `inputs`: the loop's name, and the `--<INPUT>` flags that `new` requires (`required`) or accepts (`optional`).
- `questions`: optional. A question file's name in the run folder, with `{n}`, such as `"Q-{n}.md"`. Questions exist only at the initial state.
- `preflight`: optional. The hook that runs on `new`, before the run exists.
- `result`: the hook that reads a dispatch's status from its document.
- `onAnswer`: optional. The hook that writes the human's answer into the question file. It runs once for each answer of an `answer` call.
- `artifacts`: the files the dispatches write, as the section "Artifacts" describes.
- `stages`: the loop's stages, in order, as the section "Stages" describes.
- `validators`: optional. One hook per state, which runs on every transition into that state.
- `limits`: optional. The refusals in a row (`redispatch`, default 2) and the unusable results in a row (`unusable`, default 1) before the run parks.

A hook is `{ "module": "./hooks.mts", "export": "readResult" }`: the module path is relative to the loop file, and the export must be a function.

## Artifacts

An artifact is `{ "file": NAME, "guard"?: HOOK }`. `file` is a plain file name in the run folder: no `/`, no `..`, not `run.json` or `out`, not a match of the `questions` pattern, and unique across artifacts. A `file` with `{attempt}`, such as `"verify.{attempt}.md"`, makes a per-attempt artifact: each dispatch writes a new file, and the earlier files stay. A gate can't freeze a per-attempt artifact.

## Stages

A stage is an object whose key names both its kind and its state, such as `{ "work": "build" }`. The following list describes the six kinds and the fields each one takes:

- `{ plan, route, dispatches, next? }`: the initial state. It comes first. `route` is the hook that picks the next move, `dispatches` holds the plan dispatches, and `next` names the gate or gates the route can enter.
- `{ gate, label, next?, back?, freezes? }`: a human approval point. `freezes` names the artifacts an approval freezes, and at most one gate, the *freezing gate*, declares it. `next` and `back` are the exits after an approval and a rejection. For more information about a summary at the gate, see [Show a summary at a gate](#show-a-summary-at-a-gate).
- `{ work, dispatch }`: a stage one dispatch works in, such as `build`.
- `{ verify, dispatch, pass?, fail?, maxFailed? }`: a stage that judges a work stage. `pass` and `fail` are the exits for each verdict. `maxFailed` parks the run after that many failed verdicts since the latest human move into `fail`.
- `{ stop }`: a state where the run waits for a human.
- `{ end }`: a terminal state with no exits. It comes last.

`blocked` is the engine's own state, so no stage can take the name. Every stage except an end stage can move to it.

### Dispatches

A dispatch is one task for one agent: `{ agent, artifact, message, outcomes? }`. `agent` names the agent, `artifact` the artifact whose file the dispatch writes, `message` the template of the dispatch message, and `outcomes` maps each status to its action. A plan dispatch sits under the plan stage's `dispatches`. A work or verify stage's dispatch sits under the stage's `dispatch`, and takes the stage's name.

### Actions

An outcome takes one of four actions:

| Action | Effect | Where |
| --- | --- | --- |
| `{ "transition": STATE }` | Moves the run to that state. A refusal re-dispatches the agent with the errors. | Any dispatch |
| `{ "route": true }` | Closes the dispatch, and `next` asks the route for the next move. | Plan dispatches |
| `{ "ask": true }` | Stops on the pending questions. The CLI refuses the result when no question file is pending. | Plan dispatches, with `questions` |
| `{ "park": true }` | Blocks the run with a note that names the document. | Any dispatch |

### Placeholders

A dispatch message is a template. At `next`, the engine replaces each placeholder, and refuses to open a dispatch whose message names a placeholder with no value:

| Placeholder | Value |
| --- | --- |
| `{runPath}` | The run file, as the command received it |
| `{<INPUT>}` | The input's value, or `none` for an optional input the run doesn't have |
| `{attempt}` | The number of dispatches of this name so far, this one included |
| `{document}` | The run folder joined with the artifact's `file`, `{attempt}` filled in |
| `{note}` | The note of the latest human move after the previous dispatch of this name opened, or empty |
| `{<KEY>}` | A value the route returned under `with`, in a plan dispatch's message only |

A re-dispatch after a refusal or an unusable result appends `Fixes:` and the error lines, grouped by file and section.

## Inferred values

The stage order supplies every target a stage leaves out, and an explicit value always wins. `looplock compile --config <LOOP_FILE>` prints the JSON pointer of each value the compiler inferred. The following table lists each default:

| Value | Default |
| --- | --- |
| A plan stage's `next` | The stage after it, which must be a gate |
| A gate's `next` | The stage after it |
| A gate's `back` | The plan stage |
| A verify stage's `pass` | The stage after it |
| A verify stage's `fail` | The nearest work stage before it |
| A work dispatch's outcomes | `ok` moves to the next verify stage, and `blocked` parks |
| A verify dispatch's outcomes | `pass` moves to `pass`, `fail` moves to `fail`, and `blocked` parks |

A dispatch's `outcomes` merge over the defaults: `"ok": { "transition": "deploy" }` names another target, and `"blocked": null` removes the outcome. A work stage with no verify stage after it must state `ok`. A verify stage gets no forward exit except its verdicts, so the run leaves it only through a verdict or `blocked`.

## Human edges

The compiler also gives each state its human edges, the only targets of the `transition` command:

1. Every stage after the freezing gate, except an end stage, gets an edge to the gate's `back` that drops the gate's freeze.
2. A stop stage whose previous stage is a verify stage gets an edge that retries the verify stage's `fail`.
3. A verify stage gets an edge that retries its `fail`. The run reaches it only when blocked from the verify stage.
4. Every edge into the stage that `maxFailed` guards resets the failed count.

A blocked run's human edges are the resume edge into the state it blocked from, plus the human edges of that state. When two edges share a target, they merge into one edge with both effects. `compile` prints each state's edges under `human`.

## Hooks

`config.mts` exports each hook's type. A hook can return a value or a promise, and the engine awaits it. Every hook except the preflight receives a `HookContext`: `root`, the working directory of the CLI; `runPath`, the run file as the command received it; `runDir`, the absolute run folder; and `run`, the run, read only. Every path a hook receives is absolute, except `runPath`.

| Hook | Type | Receives | Returns |
| --- | --- | --- | --- |
| `preflight` | `Preflight` | `root`, `runPath`, and the inputs | `{ errors, warnings }`: an error refuses the run, and each warning is stored with its reason |
| `result` | `ResultHook` | The document's path and the dispatch | `{ status }`, or `{ error }` for an unusable result |
| An artifact's `guard` | `Guard` | The file's path, `event`, and the dispatch and status when there is one | Error lines; an empty list accepts |
| A state's validator | `Validator` | `from`, `to`, `human`, and the dispatch when there is one | Error lines; an empty list accepts |
| `route` | `Route` | The context | `{ dispatch, with? }`, or `{ gate, onRefusal }` |
| `onAnswer` | `OnAnswer` | The question's id and file, the option key or `custom`, and the human's words | Nothing; a throw refuses the whole `answer` call, and the engine doesn't undo the hook's writes for the call's earlier answers |

A guard's `event` says why it runs: `validate` for the `validate` command, `result` for a dispatch's outcome, `enter` for a transition into the freezing gate, and `approve` for that gate's approval.

## Show a summary at a gate

To show the human a summary at the freezing gate, make the summary an artifact that the gate freezes, with a guard that writes the file. Entering the freezing gate runs the guard with `event: 'enter'` before the engine checks that every frozen file exists. The gate stop then lists the summary under `freezes`, and the approval freezes the summary the human saw. The approval runs the guard again with `event: 'approve'`, so write the file only on `enter`. The following excerpt of a loop file declares the summary and freezes it at the gate:

```json
{
  "artifacts": {
    "plan": { "file": "plan.md" },
    "summary": { "file": "summary.md", "guard": { "module": "./hooks.mts", "export": "writeSummary" } }
  },
  "stages": [
    { "gate": "gate", "label": "Gate", "freezes": ["plan", "summary"] }
  ]
}
```

The following guard writes the summary as the run enters the gate. `summarize` stands for your own code:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeSummary(path, { event, runDir }) {
    if (event === 'enter') writeFileSync(path, summarize(join(runDir, 'plan.md')));
    return [];
}
```

A gate that freezes nothing runs no guard on entry. To show a summary at such a gate, write it from the gate's validator, which runs on every transition into the gate, and name the file in the orchestrator's instructions.

## Load-time checks

When the loop file loads, the loader refuses it on each of these faults, with the stage, the artifact, or the hook at fault:

- A field the types don't name, or a hook whose module or export is missing or isn't a function.
- A first stage that isn't a plan stage, an end stage that isn't last, a stage named `blocked`, or a stage name that repeats.
- An artifact `file` that isn't a plain file name, repeats, or is a name the engine keeps.
- A `freezes` entry that names a per-attempt artifact, or two gates that declare `freezes`.
- A dispatch whose `artifact` doesn't exist, a `transition` to a state that doesn't exist, a `route` or `ask` outside a plan dispatch, or an `ask` without `questions`.
- A `validators` key that isn't a stage.
- A placeholder in a work or verify dispatch's message that isn't a fixed placeholder or an input.
- A stop stage with no human edge, because every stop lists the human's moves. To fix it, give an earlier gate `freezes`, put a verify stage right before the stop stage, or make it an end stage.
