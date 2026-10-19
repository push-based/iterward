# The loop file

This reference condenses `docs/configuration.md` and the checks in `compile-loop.ts` of Looplock 0.4.0. The compiler is the authority: when it disagrees with this page, follow the compiler and tell the user the page is stale.

## Contents

- The shape
- Semantics that drive design choices
- Machine keys and targets
- Hooks
- Compiler checks
- Example

## The shape

The following TypeScript is the exact shape. The compiler refuses any field it doesn't name.

```ts
interface LoopFile {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    preflight?: HookRef;                                   // runs on `new`, before the run exists
    questions?: { file: string; onAnswer?: HookRef };      // file has exactly one {n}, such as "Q-{n}.md"
    artifacts: Record<string, { file: string; guard?: HookRef }>;
    steps: Record<string, { agent: string; writes: string; outcomes: string[]; onEnter?: HookRef }>;
    gates?: Record<string, { label: string; freezes?: string[]; onEnter?: HookRef }>;
    stops?: Record<string, { onEnter?: HookRef }>;
    machine: Record<string, string | { ask: string }>;
    human?: Record<string, string[]>;
    limits?: { opens?: number };                           // 3 when left out
}
type HookRef = string;                                     // "<file>#<export>", the file relative to the loop file
```

Order the top-level fields as listed. `inputs.required` is required even when empty: `{ "required": [] }`.

## Semantics that drive design choices

- **Step.** One agent works on one document. `writes` names the artifact, and that artifact needs a guard, because the guard returns the step's status. `outcomes` lists every status the guard can return for the step. Two steps can write the same artifact.
- **Artifact.** A file in the run folder. A `file` with `{attempt}`, such as `build.{attempt}.md`, gets a new file on each open of a step that writes it, and the earlier files stay. An artifact that no step writes is one that a hook writes.
- **Gate.** The run waits for a human to approve or reject. Approval records the sha256 of each artifact in `freezes`. A later change to a frozen file stops the run until a human moves it into a step that writes that artifact, which drops the freeze. A gate can't freeze a per-attempt artifact, and an artifact can be frozen by one gate only. A rejection needs a note.
- **Stop.** The run waits for a human with no agent to open. A stop with no entry under `human` is terminal.
- **Park.** The run moves to `blocked` with a note. A human resumes it into the step it parked from, or takes one of that step's human moves.
- **Questions.** An agent writes question files, such as `Q-1.md`, into the run folder. The target `{ "ask": STEP }` stops the run on the pending questions, and opens `STEP` after the human answers them. The result is refused when no question file is pending, so only an outcome that means "I wrote questions" targets `ask`.
- **Human moves.** `human` maps a step or a stop to the states a human can move it to with `transition`. A gate's moves are its decisions, so a gate never appears under `human`.
- **Limits.** `limits.opens` counts the opens of one step since the latest human move: a gate decision, a transition, or an answer. The next open past it parks the run. Retries after a refused or unusable result count, and so do cycles such as build → verify → build.
- **Inputs.** Each input becomes a `--<INPUT>` flag of `new`, and every dispatch message lists them, so an agent reads them without the run file.

## Machine keys and targets

The `machine` field is a flat object from a key to a target. It takes the following keys:

| Key | Meaning | Allowed targets |
| --- | --- | --- |
| `"start"` | The first step of a new run | A step only |
| `"<step>.<outcome>"` | The target of a step's declared outcome | A step, gate, stop, `"park"`, or `{ "ask": STEP }` |
| `"*.<outcome>"` | The target for every step that declares the outcome and has no key of its own | Same as the preceding row |
| `"<gate>.approve"`, `"<gate>.reject"` | The target of a gate decision; both are required | A step, gate, or stop; never `park` or `ask` |

## Hooks

A hook is a named export of an ES module beside the loop file, and it imports nothing from Looplock. Each one receives a context with `root`, `runPath`, `runDir`, and the read-only `run`, and can return a promise.

| Hook | Signature | Returns |
| --- | --- | --- |
| `preflight` | `({ root, runPath, inputs })` | `{ errors: string[], warnings: string[] }`. An error refuses `new`. |
| An artifact's `guard` | `(path, { event, dispatch?, ...ctx })`, `event` is `result`, `enter`, `approve`, or `validate` | `{ status }` or `{ errors: string[] }` |
| A step's, gate's, or stop's `onEnter` | `({ from, to, human, dispatch?, ...ctx })` | Error lines. An empty list accepts the transition. |
| `questions.onAnswer` | `({ question: { id, file }, option, answer, ...ctx })` | Nothing. A throw refuses the whole `answer` call. |

On `result`, the guard's status is the step's outcome. At a gate entry, an approval, and `validate`, only the errors count. A refused gate entry or entry check during an agent's outcome reopens the step with the errors as its fixes.

## Compiler checks

The compiler refuses a loop file with any of these faults:

- A field the shape doesn't name, or a hook that isn't `"<file>#<export>"`.
- At `looplock compile` only: a hook whose module can't be imported, or whose export is missing or isn't a function.
- A step, gate, or stop name with characters other than letters, digits, `_`, and `-`; a name repeated across steps, gates, and stops; or one of the reserved names `blocked`, `park`, and `start`.
- No step; a `writes` that isn't an artifact; an artifact that a step writes with no guard; outcomes that are empty or repeat; an outcome or input name with characters other than letters, digits, `_`, and `-`.
- An artifact `file` with `/`, `\`, or `..`; a `file` of `run.json` or `out`; a `file` that matches the questions pattern; or two artifacts with one `file`.
- A `questions.file` without exactly one `{n}`, or with a path separator.
- A `freezes` entry that isn't an artifact, is per attempt, or is frozen by another gate.
- No `start`, or a `start` that isn't a step.
- A machine key that isn't `start`, a step's declared outcome, a `*` outcome that some step declares, or a gate's `approve` or `reject`.
- A target that isn't a step, gate, stop, `park`, or `{ "ask": STEP }`; an `ask` without `questions`; an `ask` that names a gate or stop; or a gate decision into `park` or `ask`.
- A declared outcome with no key, specific or `*`; a gate without both `approve` and `reject`.
- A `human` key that isn't a step or a stop, or a `human` target that isn't a step, gate, or stop.
- A `limits.opens` that isn't a whole number from 1.

The compiler doesn't check reachability, dead ends, or cycles. Check those yourself.

## Example

The following file is `examples/default/default.loop.json`. A planner writes a plan and can ask the human questions, a gate approves and freezes the plan, a builder builds, and a verifier sends a failed build back to the builder:

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
