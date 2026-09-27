import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { json, makeLoop, runPath, text } from '../../../spec/fixtures.mts';
import { newTool } from '../new.tool.mts';

test('new starts a run with the loop inputs and returns the preflight warnings, and refuses a run that exists', async () => {
    const config = join(makeLoop(), 'loop.json');
    const run = runPath();
    assert.deepEqual(json(await newTool.handler({ config, run, inputs: { component: 'packages/promo/x/progress-bar' } })), { ok: true, status: 'plan', warnings: ['no Sass compiler'] });
    const refused = await newTool.handler({ config, run, inputs: { component: 'packages/promo/x/progress-bar' } });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /^new refused: other:\n  - a run exists at /);
});
