# Run format

Looplock writes every file of a run beside its run file. The following tree shows the run from [Run the default loop by hand](tutorial.md):

```text
runs/example/
├── run.json             status, history, gates, decisions, and every dispatch
├── plan.json            the planner's working file
├── plan.1.json          the stored plan; run.json holds its sha256
├── results/
│   ├── 1.json           one result file per dispatch
│   └── …
├── verify.1.report.md   the proof reports the agents wrote
└── verify.2.report.md
```

A loop with checks also writes `checks.<N>.json` and a log file for each check row.
