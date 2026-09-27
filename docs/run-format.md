# Run format

Every file of a run lives in its run folder, beside `run.json`. The engine writes only `run.json` and `out/`, and agents and hooks write the rest. The following tree shows the run from [Run the default loop by hand](tutorial.md):

```text
runs/example/
├── run.json      status, history, gates, freezes, questions, and every dispatch
├── plan.md       the plan, which the gate froze
├── build.1.md    one document per build dispatch
├── build.2.md
├── verify.1.md   one document per verify dispatch
└── verify.2.md
```

## run.json

`config.mts` exports the exact shape as `Run`. Hooks read it through `HookContext.run`, and only the engine writes it, after a command succeeds. It holds these fields:

- `config`: the loop file's path and the sha256 over the loop file and its hook modules.
- `inputs`, `status`, and `blockedFrom`: the run's inputs, its state, and the state a blocked run blocked from.
- `warnings`: the preflight warnings, each with its reason.
- `gates`: each gate's latest `decision`, `note`, and `at`, and its `history`, where each entry holds `judged`, the sha256 of each file the gate judged.
- `history`: every status change, with its note, and `human: true` on a gate decision or a human transition.
- `freezes`: each frozen file by run-relative name, with its sha256, the gate or the question that froze it, and the time.
- `questions`: each question's id, file, status, chosen key, answer, and times.
- `dispatches`: each dispatch's id, name, agent, attempt, document, message, and times, the `with` values the route gave it, and its outcome and note after it closes.
- `streak` and `stopMark`: the refusals and unusable results in a row, and the dispatch counts at the last two stops.

## Documents

Each dispatch writes one document: its artifact's `file` in the run folder. A per-attempt artifact, such as `verify.{attempt}.md`, writes a new file for each dispatch, so every attempt's document stays. The result hook reads each document's status, and `result` refuses a document written before its dispatch opened.

## Freezes

A gate approval freezes the files of its artifacts, and an answer freezes its question file. A frozen file must stay as it was: a changed or missing frozen file parks an agent's move and refuses a human's. A human transition back past the gate drops the gate's freezes. A question's freeze stays.

## Question files

A file whose name matches the loop's `questions` pattern, such as `Q-1.md`, is a question. At `result`, while the run is at the initial state, each new question file joins the ledger as pending, in the order of its number. The loop's `onAnswer` hook writes the human's answer into the file, and the engine keeps no question text.

## The out folder

A refusal or a `validate` error list over 20,000 characters goes whole to `out/<NAME>.<N>.txt`, where `<N>` is the next unused number, and the output names the file.

## Reserved names

The engine keeps the names `run.json` and `out/`, so an artifact can't use them.
