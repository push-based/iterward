import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { json, makeLoop, text } from '../../../spec/fixtures.ts';
import { compileTool } from '../compile.tool.ts';

test('compile returns the compiled loop, and refuses a loop file that does not exist', async () => {
    const { config } = json(await compileTool.handler({ config: join(makeLoop(), 'loop.json') }));
    assert.equal(config.start, 'discovery');
    const refused = await compileTool.handler({ config: join(makeLoop(), 'none.json') });
    assert.deepEqual([refused.isError, text(refused).startsWith('compile refused:')], [true, true]);
    assert.equal(compileTool.schema.annotations.readOnlyHint, true);
});
