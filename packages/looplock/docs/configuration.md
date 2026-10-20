# Configuration

A loop is one JSON file, and its hooks are named exports of ES modules beside it. `loadLoop` in `load-config.ts` reads the file, imports each hook, and compiles it to the `LoopConfig` the engine runs. To start a loop of your own, copy `examples/default/`, and pass your loop file to `new --config`. A run refuses every command after its loop file, a hook module, or a local file a hook module imports changes, so start a new run after you edit a loop.

## The loop file

`config.ts` exports the loop file's exact shape as `LoopFile`. The loader refuses any field it doesn't name, with the place and the field at fault. Nothing is inferred: the file declares every step, outcome, and target. A loop file takes these fields:

- `name` and `inputs`: the loop's name, and the `--<INPUT>` flags that `new` requires (`required`) or accepts (`optional`).
- `preflight`: optional. The hook that runs on `new`, before the run exists.
- `questions`: optional. `{ "file": "Q-{n}.md", "onAnswer": HOOK }`: a question file's name in the run folder, with `{n}`, and the hook that writes the human's answer into it. `onAnswer` is optional and runs once for each answer of an `answer` call.
- `artifacts`: the documents of the run, as the section "Artifacts" describes.
- `steps`, `gates`, and `stops`: the states of the loop, as the sections "Steps", "Gates", and "Stops" describe. Steps, gates, and stops share one namespace.
- `machine`: the target of each outcome, as the section "Machine" describes.
- `human`: optional. The moves a human can make with `transition`, as the section "Human moves" describes.
- `limits`: optional. `{ "opens": N }`, as the section "Limits" describes.

A hook is the string `"<file>#<export>"`, such as `"./hooks.mts#planGuard"`: the file is relative to the loop file, and the export must be a function.

## Artifacts

An artifact is `{ "file": NAME, "guard"?: HOOK }`. `file` is a plain file name in the run folder: no `/`, no `..`, not `run.json` or `out`, not a match of the questions pattern, and unique across artifacts. A `file` with `{attempt}`, such as `"verify.{attempt}.md"`, makes a per-attempt artifact: each open of a step that writes it gets a new file, and the earlier files stay. A gate can't freeze a per-attempt artifact.

The guard belongs to the document. It runs on the result of the step that writes the document, on entering the gate that freezes it, on that gate's approval, and on the `validate` command. It returns `{ "status": STATUS }` or `{ "errors": [LINE, …] }`. On a step's result, the status is the step's outcome; at a gate and on `validate`, only the errors count. How an agent records its status in the document is the loop's concern: the guard reads it.

An artifact that no step writes is one that code writes, such as a file a guard writes. A gate can freeze it, so the approval freezes what the human saw.

## Steps

A step is one task for one agent: `{ "agent": NAME, "writes": ARTIFACT, "outcomes": [STATUS, …], "onEnter"?: HOOK }`. `writes` names the artifact the step's document is, and that artifact must have a guard, because the guard returns the step's status. `outcomes` lists every status the guard can return for the step. `onEnter` runs on every transition into the step.

## Gates

A gate is a human approval point: `{ "label": TEXT, "freezes"?: [ARTIFACT, …], "onEnter"?: HOOK }`. `freezes` names the artifacts an approval freezes; an artifact can be frozen by one gate only. A gate is left only by a decision: `machine` maps `"<gate>.approve"` and `"<gate>.reject"` to their targets. Entering a gate needs no pending question, and runs the guard of each artifact the gate freezes with `event: 'enter'`, then checks that every frozen file exists, so a guard can write one. The approval runs the guards again with `event: 'approve'`, records the sha256 of each file the human judged, and freezes the files.

## Stops

A stop is a state where the run waits for a human with no agent to open: `{ "onEnter"?: HOOK }`. A stop with no human moves is terminal.

## Machine

`machine` is a flat object from a key to a target:

| Key | Meaning |
| --- | --- |
| `"start"` | The first step of a new run. |
| `"<step>.<outcome>"` | The target of a step's outcome. |
| `"*.<outcome>"` | The target of the outcome for every step that declares it and has no key of its own. |
| `"<gate>.approve"`, `"<gate>.reject"` | The target of a gate decision: a step, a gate, or a stop. |

A target is one of the following:

| Target | Effect |
| --- | --- |
| A step | Moves the run into the step, which `next` opens. |
| A gate | Moves the run into the gate, and `next` stops for the decision. |
| A stop | Moves the run into the stop. |
| `"park"` | Blocks the run with a note that names the document. |
| `{ "ask": STEP }` | Moves the run into the step once a question file is pending. `next` stops on the questions, and opens the step after the answers. The result is refused when no question file is pending. |

`compile` checks that every declared outcome has a key, specific or `*`, and that no key names an outcome the step doesn't declare. `looplock compile --config <LOOP_FILE>` prints the compiled loop, each step's outcomes resolved to their targets.

The following excerpt maps the outcomes of a planner, a builder, and a verifier:

```json
{
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
  }
}
```

## Human moves

`human` maps a step or a stop to the states a human can move it to with `transition`: `{ "verify": ["plan", "build"] }`. A gate's moves are its decisions. A blocked run's moves are the resume into the step it parked from, plus the human moves of that step. Two effects are engine rules, not configuration:

- A human move or a gate decision into a step that writes a frozen artifact drops the freeze and the decision of the gate that froze it.
- Every human move re-freezes the answered question files at their current bytes, so an edited or deleted question file never traps the run.

## Limits

`limits.opens`, 3 when left out, bounds how many times a step opens since the latest human move: a gate decision, a human transition, or an answer. The next open past it parks the run. The count covers every open of the step: after an unusable result, a guard's refusal, a refused transition, or a cycle between two steps, such as a build and a verify that fails.

## The standard message

Every step opens with the same message, which the orchestrator sends to the step's agent word for word:

```text
Step: build
Run: runs/a/run.json
Document: runs/a/build.2.md
Inputs:
  subject: the settings page
Note: none
Fixes:
build.1.md § Checks:
  - line 3 declares no value
```

- `Document` is the run folder joined with the artifact's `file`, `{attempt}` filled in with the number of earlier opens of steps that write the same artifact, plus 1.
- `Inputs` lists every declared input, `none` for an optional input the run doesn't have.
- `Note` is the note of the latest human move after the step last opened, or `none`.
- `Fixes` lists the lines the step's previous open must fix, grouped by file and section, or `none`. A human move since then clears them.

## Hooks

`@push-based/looplock` exports each hook's type, which `config.ts` declares. A hook can return a value or a promise, and the engine awaits it. Every hook except the preflight receives a `HookContext`: `root`, the working directory of the CLI; `runPath`, the run file as the command received it; `runDir`, the absolute run folder; and `run`, the run, read only. Every path a hook receives is absolute, except `runPath`. A hook declares only the context fields it reads.

| Hook | Type | Receives | Returns |
| --- | --- | --- | --- |
| `preflight` | `Preflight` | `root`, `runPath`, and the inputs | `{ errors, warnings }`: an error refuses the run, and each warning is stored with its reason |
| An artifact's `guard` | `Guard` | The file's path, `event`, and the dispatch when there is one | `{ status }` or `{ errors }` |
| A step's, gate's, or stop's `onEnter` | `OnEnter` | `from`, `to`, `human`, and the dispatch when there is one | Error lines; an empty list accepts |
| `questions.onAnswer` | `OnAnswer` | The question's id and file, the option key or `custom`, and the human's words | Nothing; a throw refuses the whole `answer` call, and the engine doesn't undo the hook's writes for the call's earlier answers |

A guard's `event` says why it runs: `result` for the step that writes the document, `enter` for a transition into the gate that freezes it, `approve` for that gate's approval, and `validate` for the `validate` command.

## Load-time checks

When the loop file loads, the loader refuses it on each of these faults, with the place at fault:

- A field the types don't name, a hook that isn't `"<file>#<export>"`, or a hook whose module or export is missing or isn't a function.
- A step, gate, or stop name that isn't letters, digits, `_`, and `-`, repeats across the three, or is `blocked`, `park`, or `start`.
- A name of a step, gate, stop, artifact, input, or outcome that every JavaScript object has, such as `constructor` or `toString`.
- An input named `config`, `run`, or `_`, because `new` takes those flags itself.
- No step, a `writes` that isn't an artifact, an artifact a step writes with no guard, or outcomes that are empty or repeat.
- An artifact `file` that isn't a plain file name, repeats, matches the questions pattern, or is a name the engine keeps.
- A `freezes` entry that isn't an artifact, names a per-attempt artifact, or names an artifact another gate freezes.
- No `start`, or a `start` that isn't a step.
- A machine key that isn't `start`, a step's declared outcome, a `*` outcome some step declares, or a gate's `approve` or `reject`.
- A target that isn't a step, a gate, a stop, `park`, or `{ "ask": STEP }`; an `ask` without `questions`; or a gate decision into `park` or `ask`.
- A declared outcome with no key, or a gate without `approve` or `reject`.
- A `human` key that isn't a step or a stop, or a target that isn't a step, gate, or stop.
- A `limits.opens` that isn't a whole number from 1.
