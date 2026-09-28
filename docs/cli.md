# CLI reference

Run every command from the root of the repository the loop works on, because the hooks receive that directory as `root`. Each command prints one line of JSON on stdout, except `validate`, which prints text. A command exits with `0` on success, `1` on a usage error, and `2` on a refusal, with the reason on stderr. The CLI groups a refusal's lines by file and section. A refusal over 20,000 characters goes whole to the run folder's `out/`, and stderr keeps its first 40 lines and names the file.

The following table lists the 10 commands:

| Command | Flags | Output |
| --- | --- | --- |
| `new` | `--config <LOOP_FILE> --run <RUN> [--<INPUT> <VALUE> …]` | `{ ok, status, warnings }`. The loop's preflight runs first, and its errors refuse the run. `new` also refuses a run file that exists and a run folder that holds other files. |
| `compile` | `--config <LOOP_FILE>` | `{ config }`: the compiled loop, each hook as its `"<file>#<export>"` and each step's outcomes resolved to their targets. |
| `next` | `--run <RUN>` | A dispatch, `{ do: "dispatch", id, agent, message }`, or a stop. A repeated call returns the open dispatch or the same stop. |
| `result` | `--run <RUN>` | Runs the guard of the open step's document, follows the machine to its status's target, and prints the next move, as `next` prints it. |
| `show` | `--run <RUN>` | The run's state: status, inputs, gate decisions, questions, freezes, warnings, `opens`, the times the current step opened since the last human move, and the open dispatch. |
| `validate` | `<ARTIFACT> --run <RUN>` | `ok`, or the guard's error lines, grouped, with exit `2`. A per-attempt artifact validates its highest-numbered file. |
| `answer` | `--run <RUN> --answers <JSON_ARRAY>`, or `--run <RUN> --id <ID> --option <KEY\|custom> --answer <WORDS>` | `{ ok, answered, pending }`. Records every answer or none, and for each resolves the question and freezes its file. |
| `gate` | `<NAME> --run <RUN> --decision approved\|rejected [--note <TEXT>]` | `{ ok, gate, decision, status, note }`. A rejection needs `--note`. |
| `transition` | `--run <RUN> --to <STATE> --note <TEXT>` | `{ ok, status, blockedFrom }`. Moves the run along a human move of its state. |
| `--version` | None | The version. |

## Stops

A stop is one JSON object, and every field of it is data. The orchestrator decides how to word each field for the human, and when to show it. Every stop carries `status`, `moves`, `warnings`, `since`, and `recorded`, and the fields of its kind:

- **`questions`**: `questions`, the pending questions with their files.
- **`gate`**: `gate`, `label`, and `freezes`, the files an approval freezes. After an earlier decision, also `last`, that decision and its time, and `changed`, the frozen files whose bytes differ from the ones the human judged then.
- **`blocked`**: `blockedFrom` and `reason`, the park note.
- **`status`**: nothing more. The run is at a stop.

`warnings` lists the preflight warnings. `since` lists the dispatches since the last human move, with each one's outcome, minutes, and the start of its fixes. `recorded` lists the human moves since the latest closed dispatch, each with its `call`, the call's arguments, and `at`, the time the run recorded it.

`moves` lists the human's moves from the current state. Each move names its `call` and the arguments the call takes, and lists what the call changes besides the status. The following table lists the fields of each call's moves, and what the human gives for the call:

| Call | Fields | What the human gives |
| --- | --- | --- |
| `answer` | `id`, and `freezes`, the question file the answer freezes | An option key or `custom`, and the human's words |
| `gate` | `gate`, `decision`, `to`, and `freezes` or `drops` when the call changes a freeze | A note, which a rejection requires |
| `transition` | `to`, and `resumes` or `drops` when they apply | A note |

`resumes` marks the move of a blocked run back into the step it parked from. `drops` names the gate whose freeze the move drops, with the gate's files: the move goes into a step that writes an artifact the gate froze. Every human move also resets the opens count and re-freezes the answered question files at their current bytes.

The following stop is a blocked run of the default loop after the builder returned `blocked`:

```json
{"do":"stop","stop":"blocked","status":"blocked","blockedFrom":"build","reason":"builder returned blocked; the reason is in runs/example/build.1.md.",
 "moves":[{"call":"transition","to":"build","resumes":true},{"call":"transition","to":"plan","drops":{"gate":"gate","files":["runs/example/plan.md"]}}],
 "warnings":[],"since":[{"id":2,"name":"build","agent":"builder","attempt":1,"outcome":"blocked","minutes":0}],"recorded":[]}
```

## Answer

`answer` takes one of two forms. `--answers` takes a JSON array with one object for each question the human answered, each with `id`, `option`, and `answer`, so one call records every answer of one human message. `--id`, `--option`, and `--answer` record one answer. A call with both forms, or with neither, is a usage error.

The call records all of its answers or none. The CLI checks every answer first: its question is in the ledger and pending, its option and answer aren't empty, and no question appears twice. Any problem refuses the call, and the refusal lists every problem, grouped by question.

After the checks pass, the loop's `onAnswer` hook writes each answer into its question file, in order, and the question file freezes. A throw from the hook refuses the call, and the run file stays as it was. The hook's own writes for the call's earlier answers stay, because the engine doesn't undo a hook.

The following command records the answers to two questions, `Q-1` and `Q-2`, in one call:

```bash
node bin.mts answer --run runs/example/run.json --answers '[{"id":"Q-1","option":"A","answer":"One page."},{"id":"Q-2","option":"custom","answer":"Save on every change."}]'
```

The CLI prints each answered question with its chosen key, and the questions still pending:

```json
{"ok":true,"answered":[{"id":"Q-1","chosen":"A"},{"id":"Q-2","chosen":"custom"}],"pending":[]}
```

## Compile

`compile` is how you review a loop file: it prints the compiled loop with each step's outcomes resolved from `machine`, a `*` key included. The following lines are an excerpt of its output for `examples/default/default.loop.json`:

```json
{"config":{"start":"plan",
 "steps":{"plan":{"agent":"planner","writes":"plan","outcomes":{"ok":"gate","needs-decisions":{"ask":"plan"},"blocked":"park"}},
  "build":{"agent":"builder","writes":"build-report","outcomes":{"ok":"verify","blocked":"park"}},
  "verify":{"agent":"verifier","writes":"verify-report","outcomes":{"pass":"done","fail":"build","blocked":"park"}}},
 "gates":{"gate":{"label":"Gate","freezes":["plan"],"approve":"build","reject":"plan"}},
 "stops":{"done":{}},"human":{"build":["plan"],"verify":["plan","build"]},"limits":{"opens":3}}}
```

A loop file the engine can't run exits `2`, and the reason names the place and the field at fault.
