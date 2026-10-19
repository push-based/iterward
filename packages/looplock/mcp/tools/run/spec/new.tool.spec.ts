import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { json, makeLoop, runPath, text } from '../../../spec/fixtures.ts';
import { newTool } from '../new.tool.ts';

test('new starts a run with the loop inputs and returns the preflight warnings, and refuses a run that exists', async () => {
    const config = join(makeLoop(), 'loop.json');
    const run = runPath();
    assert.deepEqual(json(await newTool.handler({ config, run, inputs: { subject: 'the progress bar' } })), { ok: true, status: 'discovery', warnings: ['no linter'] });
    const refused = await newTool.handler({ config, run, inputs: { subject: 'the progress bar' } });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /^new refused: other:\n  - a run exists at /);
});
