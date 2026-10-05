/**
 * node --test examples/default/default.spec.mts
 *
 * The default loop end to end, through the CLI: a question and its answer, a gate rejection whose note reaches
 * the planner, an approval, a failed verification and its retry, and a pass into `done`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin.mts', import.meta.url));
const LOOP = fileURLToPath(new URL('default.loop.json', import.meta.url));

test('the default loop takes a run from plan to done', () => {
    const run = join(mkdtempSync(join(tmpdir(), 'looplock-default-')), 'run.json');
    const dir = dirname(run);
    const cli = (...args: string[]) => {
        const res = spawnSync(process.execPath, [BIN, ...args, '--run', run], { encoding: 'utf8' });
        assert.equal(res.status, 0, res.stderr);
        return JSON.parse(res.stdout);
    };
    const doc = (file: string, status: string) => writeFileSync(join(dir, file), `---\nid: ${file.replace(/\.md$/, '')}\nstatus: ${status}\n---\n`);

    const message = (step: string, document: string, note = 'none') => [`Step: ${step}`, `Run: ${run}`, `Document: ${join(dir, document)}`, 'Inputs:', '  subject: the settings page', `Note: ${note}`, 'Fixes: none'].join('\n');
    assert.deepEqual(cli('new', '--config', LOOP, '--subject', 'the settings page'), { ok: true, status: 'plan', warnings: [] });
    assert.equal(cli('next').message, message('plan', 'plan.md'));

    doc('plan.md', 'needs-decisions');
    writeFileSync(join(dir, 'Q-1.md'), '---\nid: Q-1\nstatus: pending\n---\n\nWhich layout?\n\n- A. One page\n- B. Two pages\n');
    const asked = cli('result');
    assert.deepEqual([asked.stop, asked.questions], ['questions', [{ id: 'Q-1', file: join(dir, 'Q-1.md') }]]);
    assert.deepEqual(asked.moves, [{ call: 'answer', id: 'Q-1', freezes: [join(dir, 'Q-1.md')] }]);
    assert.deepEqual(cli('answer', '--id', 'Q-1', '--option', 'A', '--answer', 'One page.'), { ok: true, answered: [{ id: 'Q-1', chosen: 'A' }], pending: [] });
    assert.match(readFileSync(join(dir, 'Q-1.md'), 'utf8'), /^---\nid: Q-1\nstatus: resolved\nchosen: A\nanswer: "One page."\n---\n\nWhich layout\?/);

    assert.equal(cli('next').agent, 'planner');
    doc('plan.md', 'ok');
    const gate = cli('result');
    assert.deepEqual([gate.stop, gate.freezes], ['gate', [join(dir, 'plan.md')]]);
    assert.deepEqual(gate.moves[0], { call: 'gate', gate: 'gate', decision: 'approved', to: 'build', freezes: [join(dir, 'plan.md')] });

    cli('gate', 'gate', '--decision', 'rejected', '--note', 'Add a cancel button.');
    assert.equal(cli('next').message, message('plan', 'plan.md', 'Add a cancel button.'));
    doc('plan.md', 'ok');
    assert.equal(cli('result').stop, 'gate');
    assert.equal(cli('gate', 'gate', '--decision', 'approved').status, 'build');

    assert.equal(cli('next').message, message('build', 'build.1.md'));
    doc('build.1.md', 'ok');
    assert.equal(cli('result').agent, 'verifier');
    doc('verify.1.md', 'fail');
    assert.match(cli('result').message, /^Document: .*build\.2\.md$/m);
    doc('build.2.md', 'ok');
    assert.match(cli('result').message, /^Document: .*verify\.2\.md$/m);
    doc('verify.2.md', 'pass');
    const done = cli('result');
    assert.deepEqual([done.stop, done.status, done.moves], ['status', 'done', []]);
    assert.deepEqual([cli('show').status, cli('show').opens], ['done', 0]);
});
