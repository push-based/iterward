# Testing

A loop's protocol is code, so you test it with `node:test`, the Node.js test runner.

## Test a loop

`loop(config)` returns the same `next` and `result` operations that the CLI calls, and your test plays each agent by writing its result file.

The following test checks that a gate rejection in the default preset sends the human's note to the planner. It sits in the repository root. For your own loop, change the two import paths:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loop } from './engine.mts';
import preset from './presets/default.mts';

test('a gate rejection sends the human note to the planner', () => {
    const L = loop(preset);
    const dir = mkdtempSync(join(tmpdir(), 'loop-'));
    const runPath = join(dir, 'run.json');
    const run = L.newRun({ subject: 'the settings page' });
    // Play the dispatched agent: write its result file, then let the engine route it.
    const reply = (doc: object) => {
        writeFileSync(run.dispatches!.at(-1)!.result, JSON.stringify(doc));
        return L.result(runPath, run);
    };

    L.next(runPath, run);
    const plan = join(dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({ steps: ['Add the form'], decisionsApplied: [], obligations: [] }));
    assert.equal(reply({ status: 'ok', plan }).stop, 'gate');

    L.reject(run, 'gate', 'Split the form into two pages');
    const again = L.next(runPath, run);
    assert.equal(again.agent, 'planner');
    assert.match(again.message, /Split the form into two pages/);
});
```

`engine.spec.mts` tests the engine's own rules with the same pattern.

## Run the engine's tests

Run the engine's tests from the repository root:

```bash
node --test *.spec.mts
```

One test in `engine.spec.mts` keeps the engine domain independent. It scans every file outside the specs for terms from the workflow Looplock came from, and fails on a match. Put a loop for a specific domain in its own directory, outside this repository.
