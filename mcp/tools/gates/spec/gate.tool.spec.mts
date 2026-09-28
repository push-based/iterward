import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startedRun, text } from '../../../spec/fixtures.mts';
import { gateTool } from '../gate.tool.mts';

test('gate refuses a decision outside its enum, and passes the gate name to the CLI', async () => {
    const run = startedRun();
    const malformed = await gateTool.handler({ gate: 'gate', run, decision: 'maybe', scope: 'values' });
    assert.equal(malformed.isError, true);
    assert.equal(text(malformed), 'gate malformed call: decision must be one of approved, rejected; unknown argument scope');
    // A refusal that names the gate proves the name reached the CLI as its second word.
    assert.equal(text(await gateTool.handler({ gate: 'gate', run, decision: 'approved' })), 'gate refused: other:\n  - gate gate needs status gate, not plan');
});
