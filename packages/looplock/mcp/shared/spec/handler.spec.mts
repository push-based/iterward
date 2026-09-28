/**
 * node --test mcp/shared/spec/handler.spec.mts
 *
 * Proves the tool handler's contract: arguments become CLI flags, the schema refuses a bad call before the
 * CLI runs, and a CLI refusal or malformed call comes back as an error result.
 */

import assert from 'node:assert/strict';
import { extname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runPath, text } from '../../spec/fixtures.mts';
import { BIN, createHandler, flags, type ToolSchema } from '../handler.mts';

const schema: ToolSchema = {
    name: 'probe',
    description: 'A tool for the spec.',
    inputSchema: {
        type: 'object',
        properties: {
            run: { type: 'string' },
            decision: { type: 'string', enum: ['approved', 'rejected'] },
            refs: { type: 'array', items: { type: 'string' } },
            inputs: { type: 'object', additionalProperties: { type: 'string' } },
            entries: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
        },
        required: ['run'],
        additionalProperties: false,
    },
    annotations: { title: 'Probe', readOnlyHint: true, openWorldHint: false },
};

test('flags turns arguments into CLI flags', () => {
    assert.deepEqual(flags({ run: 'r', dryRun: true, keys: false, note: undefined, fields: ['a', 'b'], gate: 'g' }, ['gate']), ['--run', 'r', '--dry-run', '--fields', 'a,b']);
});

test('a call the schema refuses never reaches the CLI, and the result lists every error', async () => {
    const res = await createHandler(schema, () => assert.fail('the CLI ran'))({ decision: 'maybe', refs: ['a', 1], inputs: { k: true }, entries: [{ id: 'a' }, { id: 1 }, { key: 'k' }, 'b'], extra: 1 });
    assert.equal(res.isError, true);
    assert.equal(
        text(res),
        'probe malformed call: run is required; decision must be one of approved, rejected; refs[1] must be a string; inputs.k must be a string; ' +
            'entries[1].id must be a string; entries[2].id is required; unknown argument entries[2].key; entries[3] must be an object; unknown argument extra',
    );
});

test('a CLI refusal (exit 2) and a malformed CLI call (exit 1) come back as error results with the reason', async () => {
    const refused = await createHandler(schema, (p) => ['show', '--run', p.run])({ run: runPath() });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /^probe refused: ENOENT/);
    const malformed = await createHandler(schema, () => ['bogus'])({ run: runPath() });
    assert.equal(malformed.isError, true);
    assert.match(text(malformed), /^probe malformed call: Usage: looplock </);
});

test('the handler runs the CLI beside it with its own extension, so a built copy runs bin.mjs', () => {
    assert.equal(BIN, fileURLToPath(new URL('../../../bin.mts', import.meta.url)));
    assert.equal(extname(BIN), extname(fileURLToPath(new URL('../handler.mts', import.meta.url))));
});
