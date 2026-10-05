import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startedRun, text } from '../../../spec/fixtures.mts';
import { nextTool } from '../next.tool.mts';
import { resultTool } from '../result.tool.mts';

test('result passes id to the CLI, which refuses a dispatch that is not the open one', async () => {
    const run = startedRun();
    await nextTool.handler({ run });
    assert.equal(text(await resultTool.handler({ run, id: 0 })), 'result malformed call: id must be an integer from 1');
    assert.equal(text(await resultTool.handler({ run, id: 2 })), "result refused: other:\n  - dispatch 2 isn't open (dispatch 1 is)");
});
