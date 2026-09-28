import assert from 'node:assert/strict';
import { test } from 'node:test';

import { json, startedRun } from '../../../spec/fixtures.mts';
import { nextTool } from '../next.tool.mts';

test('next returns the first dispatch of a run', async () => {
    const move = json(await nextTool.handler({ run: startedRun() }));
    assert.deepEqual([move.do, move.agent], ['dispatch', 'scout']);
});
