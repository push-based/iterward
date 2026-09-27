import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { startedRun, text } from '../../../spec/fixtures.mts';
import { validateTool } from '../validate.tool.mts';

test('validate runs the artifact\'s guard on its file: ok, or a refusal with the grouped lines', async () => {
    const run = startedRun();
    writeFileSync(join(dirname(run), 'plan.md'), '---\nid: plan\nstatus: ok\n---\n');
    assert.deepEqual(await validateTool.handler({ artifact: 'plan', run }), { content: [{ type: 'text', text: 'ok' }] });
    writeFileSync(join(dirname(run), 'errors.txt'), 'plan.md § Tokens: key fill cites no row\n');
    assert.equal(text(await validateTool.handler({ artifact: 'plan', run })), 'validate refused: plan.md § Tokens:\n  - key fill cites no row');
    assert.match(text(await validateTool.handler({ artifact: 'nope', run })), /^validate refused: other:\n {2}- validate takes discovery, plan, diff, verdict, build-report, verify-report, not nope$/);
});
