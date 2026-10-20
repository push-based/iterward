import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { json, text } from '../../../spec/fixtures.ts';
import { compileTool } from '../compile.tool.ts';
import { initTool } from '../init.tool.ts';

test('init copies the default loop without its spec, the copy compiles, and a second init into the folder refuses', async () => {
    const to = join(mkdtempSync(join(tmpdir(), 'iterward-init-')), 'loops/review');
    const { config } = json(await initTool.handler({ to }));
    assert.equal(config, join(to, 'default.loop.json'));
    assert.deepEqual(readdirSync(to).sort(), ['README.md', 'agents', 'default.loop.json', 'hooks.mts']);
    assert.equal(json(await compileTool.handler({ config })).config.name, 'default');
    const again = await initTool.handler({ to });
    assert.deepEqual([again.isError, text(again)], [true, `init refused: other:\n  - ${to} exists; pass --to with a folder that doesn't`]);
});
