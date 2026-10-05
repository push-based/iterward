import assert from 'node:assert/strict';
import { test } from 'node:test';

import { json, startedRun, text } from '../../../spec/fixtures.mts';
import { showTool } from '../show.tool.mts';

test("show returns the run's state and takes only the run", async () => {
    const run = startedRun();
    const shown = json(await showTool.handler({ run }));
    assert.deepEqual([shown.status, shown.inputs, shown.open], ['discovery', { subject: 'the progress bar' }, null]);
    assert.equal(text(await showTool.handler({ run, file: 'plan' })), 'show malformed call: unknown argument file');
    assert.equal(showTool.schema.annotations.readOnlyHint, true);
});
