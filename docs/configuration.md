# Configuration

A loop is a TypeScript module whose default export is a `defineLoop` configuration from `engine.mts`. To start one, copy `presets/default.mts`, and pass your file to `new --config`. A run refuses every command after its configuration file changes, so start a new run after you edit a loop.

## Fields

A configuration has these fields:

- `name` and `inputs`: the loop's name, and the `--<INPUT>` flags that `new` requires or accepts.
- `initial` and `states`: the initial status, and each status with the statuses it can move to.
- `artifacts`: the files agents store at the initial status. `store: 'versioned'` writes the next unused `<NAME>.<K>.json`, and `store: 'over'` rewrites `<NAME>.stored.json`. A `guard` returns the errors that refuse a document, and `projection` requires the document to apply the active decisions.
- `draft`: a working file beside the run that `show` names.
- `gates`: the human approval points. `freezes` names the artifact an approval freezes, `next` and `back` name the exits, and `scopes` and `summary` shape a rejection and the gate stop.
- `verify`: each verify status, with its `phase`, its `pass` and `fail` exits, and whether a pass needs `checks`.
- `invalidate`: the statuses that can re-open the frozen artifact, the status the run returns to, and the statuses that need a proof report to do so.
- `revoke`: the status where a human can reject a recorded pass, and the status the run moves to.
- `checks`: the check rows a verify phase runs, through `cmd` for an external command, run without a shell, and `fact` for a row decided from files. The harness lists the changed files with `git status`, so a loop with checks needs Git.
- `route`, `routeTransitions`, and `byStatus`: the dispatch at the initial status, the routes that are transitions instead, and the dispatch at each other status.
- `dispatches`: each route's agent, and a function that builds its message from the output of `show`.
- `human`: the routes a human starts with `dispatch <ROUTE> --text`.
- `results`: for each agent, the action each result status takes.
- `stops`: the statuses where the run stops for the human.
- `limits`: the refusals in a row (`redispatch`, default 2) and the unusable results (`unusable`, default 1) before the run parks, and the failed verifications since the approval (`failed`) before it parks.
- `decisionsField`, `obligationsField`, and `resumeSuffix`: the artifact fields that hold the applied decisions and the obligations, and the text added to a dispatch that resumes after a supplement.

## Result actions

The following table lists the actions a result status can take in `results`, and the field a result must carry for each:

| Action | Effect | Required result field |
| --- | --- | --- |
| `{ store, from }` | Stores the file that `from` names as the `store` artifact. | The `from` field |
| `{ ask }` | Stores the questions in the file that `ask` names, and stops for the human. | The `ask` field |
| `{ supplement }` | Dispatches the `supplement` route with the result, then resumes the original dispatch. It works once per pass. | `requests` |
| `{ dispatch, fixes, maxPerCycle, park }` | Dispatches another route with `fixes(result)`, and parks the run past `maxPerCycle`. | `reason` |
| `{ relay }` | Prints `{"do":"relay"}` with the `relay` field for the human. | The `relay` field |
| `{ transition }` | Moves the run to that status. | None |
| `{ invalidate: true }` | Re-opens the frozen artifact. | `reason` |
| `{ park: true }` | Moves the run to `blocked` with the blockers. | `blockers` |
| `{ verify }` | Records a `pass` or `fail` verdict for the verify phase. | `report` |
