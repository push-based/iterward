import assert from 'node:assert/strict';
import { test } from 'node:test';

import { json, startedRun } from '../../../spec/fixtures.ts';
import { nextTool } from '../next.tool.ts';

test('next returns the first dispatch of a run', async () => {
    const move = json(await nextTool.handler({ run: startedRun() }));
    assert.deepEqual([move.do, move.agent], ['dispatch', 'scout']);
});
