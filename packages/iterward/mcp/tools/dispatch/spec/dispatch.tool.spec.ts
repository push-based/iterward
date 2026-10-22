import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { json, startedRun, text } from '../../../spec/fixtures.ts';
import { dispatchTool } from '../dispatch.tool.ts';
import { nextTool } from '../next.tool.ts';

test('dispatch returns the open dispatch with the message next returned byte for byte, and changes nothing', async () => {
    const run = startedRun();
    const opened = json(await nextTool.handler({ run }));
    const bytes = readFileSync(run);
    const open = json(await dispatchTool.handler({ run }));
    assert.deepEqual([open.id, open.step, open.agent, open.attempt, open.message], [opened.id, 'discovery', opened.agent, 1, opened.message]);
    assert.deepEqual(readFileSync(run), bytes);
    assert.equal(dispatchTool.schema.annotations.readOnlyHint, true);
});

test('dispatch refuses when no dispatch is open, and refuses a malformed call', async () => {
    const run = startedRun();
    const none = await dispatchTool.handler({ run });
    assert.deepEqual([none.isError, text(none)], [true, 'dispatch refused: other:\n  - no open dispatch']);
    assert.equal(text(await dispatchTool.handler({})), 'dispatch malformed call: run is required');
    assert.equal(text(await dispatchTool.handler({ run, id: 1 })), 'dispatch malformed call: unknown argument id');
});
