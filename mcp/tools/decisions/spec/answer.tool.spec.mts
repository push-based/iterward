import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askedRun, json, text } from '../../../spec/fixtures.mts';
import { answerTool } from '../answer.tool.mts';

test('answer records every entry of its list in one call, and the schema refuses a malformed entry before the CLI runs', async () => {
    const run = askedRun('RFC-1', 'RFC-2');
    const malformed = await answerTool.handler({ run, answers: [{ id: 'RFC-1', option: 'A' }, { id: 'RFC-2', option: 'B', answer: 'b', note: 'n' }, { id: 'RFC-2', option: 2, answer: 'b' }, 'RFC-2: B'] });
    assert.equal(text(malformed), 'answer malformed call: answers[0].answer is required; unknown argument answers[1].note; answers[2].option must be a string; answers[3] must be an object');
    assert.equal(text(await answerTool.handler({ run, answers: { id: 'RFC-1', option: 'A', answer: 'a' } })), 'answer malformed call: answers must be an array');
    assert.match(text(await answerTool.handler({ run, answers: [] })), /^answer malformed call: --answers takes a JSON array of one or more/);
    const answered = json(await answerTool.handler({ run, answers: [{ id: 'RFC-1', option: 'A', answer: 'a' }, { id: 'RFC-2', option: 'custom', answer: "the human's own words" }] }));
    assert.deepEqual(answered, { ok: true, answered: [{ id: 'RFC-1', chosen: 'A' }, { id: 'RFC-2', chosen: 'custom' }], pending: [] });
});
