# Testing

A loop's protocol is a loop file and hooks, so you test it with `node:test`, the Node.js test runner.

## Test a loop

`loop(await loadLoop(path))` returns the same `next` and `result` operations that the CLI calls. Your test plays each agent by writing its document, a Markdown file whose frontmatter carries the status, and never writes a result file of its own.

The following test checks that a gate rejection in the default loop sends the human's note to the planner. It sits in the repository root. For your own loop, change the import path and the loop file:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadLoop, loop } from './engine.mts';

const CONFIG = 'examples/default/default.loop.json';

test('a gate rejection sends the human note to the planner', async () => {
    const L = loop(await loadLoop(CONFIG));
    const dir = mkdtempSync(join(tmpdir(), 'loop-'));
    const runPath = join(dir, 'run.json');
    const run = await L.newRun(runPath, { subject: 'the settings page' }, CONFIG);
    // Play the planner: write its document with a status in the frontmatter.
    const plan = () => writeFileSync(join(dir, 'plan.md'), '---\nid: plan\nstatus: ok\n---\n');

    await L.next(runPath, run);
    plan();
    assert.equal((await L.result(runPath, run) as { stop?: string }).stop, 'gate');

    await L.reject(runPath, run, 'gate', 'Split the form into two pages');
    const again = await L.next(runPath, run) as { agent?: string; message?: string };
    assert.equal(again.agent, 'planner');
    assert.match(again.message ?? '', /Split the form into two pages/);
});
```

A document must be written after its dispatch opens, because `result` refuses an older file. To test a loop through the CLI, as a harness drives it, see `examples/default/default.spec.mts`. To test what a loop file compiles to, assert on the `LoopConfig` that `loadLoop` returns: each step's `outcomes` hold the targets `machine` resolves to, a `*` key included.

## Run the engine's tests

Run the engine's tests from the repository root:

```bash
node --test '**/*.spec.mts'
```

One test in `engine.spec.mts` keeps the repository domain independent. It scans every file of the repository, the specs and their fixtures included, for terms from the workflow Looplock came from, and fails on a match. Put a loop for a specific domain in its own directory, outside this repository.
