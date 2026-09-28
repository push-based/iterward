# CLI reference

Run every command from the root of the repository the loop works on, because the hooks receive that directory as `root`. Each command prints one line of JSON on stdout, except `validate`, which prints text. A command exits with `0` on success, `1` on a usage error, and `2` on a refusal, with the reason on stderr. The CLI groups a refusal's lines by file and section. A refusal over 20,000 characters goes whole to the run folder's `out/`, and stderr keeps its first 40 lines and names the file.

The following table lists the 10 commands:

| Command | Flags | Output |
| --- | --- | --- |
| `new` | `--config <LOOP_FILE> --run <RUN> [--<INPUT> <VALUE> …]` | `{ ok, status, warnings }`. The loop's preflight runs first, and its errors refuse the run. `new` also refuses a run file that exists and a run folder that holds other files. |
| `compile` | `--config <LOOP_FILE>` | `{ config, inferred }`: the compiled loop, each hook as its `{ module, export }`, and the JSON pointer of each value the compiler inferred. |
| `next` | `--run <RUN>` | A dispatch, `{ do: "dispatch", id, agent, message }`, or a stop. A repeated call returns the open dispatch or the same stop. |
| `result` | `--run <RUN>` | Reads the open dispatch's document, applies the action of its status, and prints the next move, as `next` prints it. |
| `show` | `--run <RUN>` | The run's state: status, inputs, gate decisions, questions, freezes, warnings, the failed count, and the open dispatch. |
| `validate` | `<ARTIFACT> --run <RUN>` | `ok`, or the guard's error lines, grouped, with exit `2`. A per-attempt artifact validates its highest-numbered file. |
| `answer` | `--run <RUN> --answers <JSON_ARRAY>`, or `--run <RUN> --id <ID> --option <KEY\|custom> --answer <WORDS>` | `{ ok, answered, pending }`. Records every answer or none, and for each resolves the question and freezes its file. |
| `gate` | `<NAME> --run <RUN> --decision approved\|rejected [--note <TEXT>]` | `{ ok, gate, decision, status, note }`. A rejection needs `--note`. |
| `transition` | `--run <RUN> --to <STATE> --note <TEXT>` | `{ ok, status, blockedFrom }`. Moves the run along a human edge of its state. |
| `--version` | None | The version. |

## Stops

A stop is one JSON object. Every stop carries `status`, `moves`, `since`, and `recorded`, and the fields of its kind:

- **`questions`**: `questions`, the pending questions with their files.
- **`gate`**: `gate`, `label`, `freezes`, the files an approval freezes, and `summary`, the lines of the gate's summary hook.
- **`blocked`**: `blockedFrom` and `reason`, the park note.
- **`status`**: nothing more. The run is at a stop or an end stage.

`moves` lists the human's moves from the current state, as lines the orchestrator shows word for word. `warnings` lists the preflight warnings while the freezing gate isn't approved, and always in a loop with no freezing gate. `since` lists the dispatches between the last two distinct stops, with each one's outcome, minutes, and refusal note. `recorded` lists the human moves since the latest closed dispatch.

The following stop is a blocked run of the default loop after the builder returned `blocked`:

```json
{"do":"stop","stop":"blocked","status":"blocked","blockedFrom":"build","reason":"builder returned blocked; the reason is in runs/example/build.1.md.",
 "moves":["`transition` to build, with the human's note: resumes build, and the failed count resets.","`transition` to plan, with the human's note: moves to plan and drops the Gate freeze on plan.md."],
 "since":[{"id":2,"name":"build","agent":"builder","attempt":1,"outcome":"blocked","minutes":0}],"recorded":[]}
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

`compile` is how you review what a loop's stages leave to the compiler. The following lines are an excerpt of its output for `examples/default/default.loop.json`, where each pointer in `inferred` names a value in `config`:

```json
{"config":{"human":{"build":[{"to":"plan","drops":"gate"}],"verify":[{"to":"plan","drops":"gate"},{"to":"build","retries":true,"resets":true}]},
 "gates":{"gate":{"label":"Gate","next":"build","back":"plan","freezes":["plan"]}},
 "limits":{"redispatch":2,"unusable":1,"failed":{"stage":"verify","at":"build","max":3}}},
 "inferred":["/states/plan/0","/gates/gate/next","/gates/gate/back","/dispatches/build/outcomes/ok","/dispatches/build/outcomes/blocked","/dispatches/verify/outcomes/pass","/dispatches/verify/outcomes/fail","/dispatches/verify/outcomes/blocked","/limits/failed"]}
```

A loop file the engine can't run exits `2`, and the reason names the stage, the artifact, or the hook at fault.
