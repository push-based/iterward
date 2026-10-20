import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { json, makeLoop, runPath, startedRun, text } from '../../../spec/fixtures.ts';
import { newTool } from '../new.tool.ts';

test('new starts a run with the loop inputs and returns the preflight warnings, and refuses a run that exists', async () => {
    const config = join(makeLoop(), 'loop.json');
    const run = runPath();
    assert.deepEqual(json(await newTool.handler({ config, run, inputs: { subject: 'the progress bar' } })), { ok: true, status: 'discovery', warnings: ['no linter'] });
    const refused = await newTool.handler({ config, run, inputs: { subject: 'the progress bar' } });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /^new refused: other:\n  - a run exists at /);
});

test('an input named _ or $ never replaces the command or its name, so new can never run another command', async () => {
    const run = startedRun();
    const before = readFileSync(run, 'utf8');
    for (const inputs of [{ _: 'next' }, { $: 'gate', subject: 's' }]) {
        const res = await newTool.handler({ config: join(makeLoop(), 'loop.json'), run, inputs });
        assert.equal(res.isError, true);
        assert.match(text(res), /^new malformed call: unexpected argument --[_$]\n/);
    }
    assert.equal(readFileSync(run, 'utf8'), before, 'the run is unchanged');
});
