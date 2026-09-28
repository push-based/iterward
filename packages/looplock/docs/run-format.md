# Run format

Every file of a run lives in its run folder, beside `run.json`. The engine writes only `run.json` and `out/`, and agents and hooks write the rest. The following tree shows the run from [Run the default loop by hand](tutorial.md):

```text
runs/example/
├── run.json      status, history, gates, freezes, questions, and every dispatch
├── plan.md       the plan, which the gate froze
├── build.1.md    one document per open of build
├── build.2.md
├── verify.1.md   one document per open of verify
└── verify.2.md
```

## run.json

`config.mts` exports the exact shape as `Run`. Hooks read it through `HookContext.run`, and only the engine writes it, after a command succeeds. It holds these fields:

- `config`: the loop file's path and the sha256 over the loop file and its hook modules.
- `inputs`, `status`, and `blockedFrom`: the run's inputs, its state, and the step a blocked run parked from.
- `warnings`: the preflight warnings, each with its reason.
- `gates`: each gate's latest `decision`, `note`, and `at`, and its `history`, where each entry holds `judged`, the sha256 of each file the gate judged.
- `history`: every status change, with its note, and `human: true` on a gate decision or a human transition.
- `freezes`: each frozen file by run-relative name, with its sha256, the gate or the question that froze it, and the time.
- `questions`: each question's id, file, status, chosen key, answer, and times.
- `dispatches`: each dispatch's id, step name, agent, attempt, document, message, and times, and after it closes, its outcome, which is the guard's status, `refused`, or `unusable`, and `fixes`, the lines the step's next open must fix. The `opens` limit counts these entries since the latest human move, so the run stores no counter.

## Documents

Each dispatch writes one document: its step's artifact `file` in the run folder. A per-attempt artifact, such as `verify.{attempt}.md`, gets a new file for each open, so every attempt's document stays. The artifact's guard reads each document's status, and `result` refuses a document written before its dispatch opened.

## Freezes

A gate approval freezes the files of its artifacts, and an answer freezes its question file. A frozen file must stay as it was: a changed or missing frozen file parks an agent's move and refuses a human's. A human move into a step that writes a frozen artifact drops the freezes of the gate that froze it. A question's freeze stays, and every human move re-freezes it at the file's current bytes.

## Question files

A file whose name matches the loop's `questions` pattern, such as `Q-1.md`, is a question. At `result`, each new question file joins the ledger as pending, in the order of its number, and the run stops on it before the next step opens. The loop's `onAnswer` hook writes the human's answer into the file, and the engine keeps no question text.

## The out folder

A refusal or a `validate` error list over 20,000 characters goes whole to `out/<NAME>.<N>.txt`, where `<N>` is the next unused number, and the output names the file.

## Reserved names

The engine keeps the names `run.json` and `out/`, so an artifact can't use them.
