# CLI reference

Run every command from the root of the repository the loop works on, because guards and checks resolve paths from there. Every command takes `--run <RUN>`, except `new`, which also takes `--config <LOOP>`. Each command prints one JSON line. It exits with `0` on success, `1` on a malformed call, and `2` on a refusal, with the reason on stderr.

The following table lists the commands:

| Command | Other flags | Effect |
| --- | --- | --- |
| `new` | `--<INPUT> <VALUE>` for each loop input | Starts a run. It refuses a run file that exists. |
| `next` | None | Prints the move the run needs: a dispatch, a stop, or a relay. |
| `result` | None | Reads the open dispatch's result file, and applies the loop's action. |
| `dispatch <ROUTE>` | `--text` | Starts a human route, such as a clarification. |
| `show` | `--file`, `--pointer`, `--fields`, `--keys` | Prints the run's summary, or one field of an artifact. |
| `summary` | `--gate` | Prints a gate's summary. |
| `store <ARTIFACT>` | `--file`, `--dry-run` | Stores an artifact, or runs its checks with `--dry-run`. |
| `ask` | `--questions` | Stores pending questions. |
| `answer` | `--id`, `--option` or `--custom`, `--answer` | Records a human decision. |
| `decisions` | `--pending` or `--retired` | Lists the active decisions, or the pending or retired questions. |
| `redirect` | `--note` | Retires the pending questions with the human's note. |
| `gate <NAME>` | `--decision`, `--note`, `--scope`, `--supersedes` | Records a gate's approval or rejection. |
| `checks` | None | Runs the check rows for the current verify attempt. |
| `transition` | `--to`, `--note`, `--proof` | Moves the run along `states`. |
| `verify` | `--phase`, `--verdict`, `--proof`, `--obligations` | Records a verdict. |
| `revoke` | `--phase`, `--note`, `--proof` | Rejects a recorded pass. |
| `invalidate` | `--reason`, `--refs`, `--proof` | Re-opens the frozen artifact. |
