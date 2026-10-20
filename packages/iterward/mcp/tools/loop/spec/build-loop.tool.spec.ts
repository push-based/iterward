import assert from 'node:assert/strict';
import { test } from 'node:test';

import { text } from '../../../spec/fixtures.ts';
import { buildLoopTool } from '../build-loop.tool.ts';

test('build-loop returns the skill, then the reference and the template it reads, and takes no argument', async () => {
    const skill = text(await buildLoopTool.handler({}));
    assert.match(skill, /^---\nname: build-loop\n/);
    assert.ok(skill.indexOf('# File: references/loop-file.md') > skill.indexOf('# Build a loop'));
    assert.ok(skill.indexOf('# File: assets/hooks.mts\n\n```ts\n') > skill.indexOf('# File: references/loop-file.md'));
    assert.equal(text(await buildLoopTool.handler({ name: 'x' })), 'build-loop malformed call: unknown argument name');
    assert.equal(buildLoopTool.schema.annotations.readOnlyHint, true);
});
