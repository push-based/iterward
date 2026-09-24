/**
 * node --test tools/scripts/looplock/bin.spec.mts
 *
 * Proves the CLI's contract: exit codes, flag parsing, the run's hold on its configuration file, the
 * human-started dispatch, and output that reaches a pipe whole.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BIN = fileURLToPath(new URL('./bin.mts', import.meta.url));
const PRESET = fileURLToPath(new URL('./presets/default.mts', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const json = (res: { stdout: string }) => JSON.parse(res.stdout);

/** A configuration file of its own that re-exports the default preset, so a spec can edit it. */
function ownConfig(d: string) {
    const f = join(d, 'loop.mts');
    writeFileSync(f, `export { default } from ${JSON.stringify(pathToFileURL(PRESET).href)};\n`);
    return f;
}

test('usage errors exit 1, refusals exit 2, --version prints the version', () => {
    assert.match(cli('--version').stdout, /^\d+\.\d+\.\d+\n$/);
    assert.equal(cli('bogus').status, 1);
    assert.equal(cli('store', '--run', 'x').status, 1, 'store needs an artifact name');
    assert.equal(cli('new', '--config', PRESET).status, 1, 'new needs --run');
    const d = mkdtempSync(join(tmpdir(), 'looplock-bin-'));
    assert.equal(cli('new', '--config', PRESET, '--run', join(d, 'run.json')).status, 1, 'new needs the inputs the loop requires');
    assert.equal(cli('show', '--run', join(d, 'none.json')).status, 2, 'a missing run is a refusal');
});

test('a run holds on to its configuration file: a changed file refuses every command', () => {
    const d = mkdtempSync(join(tmpdir(), 'looplock-bin-'));
    const run = join(d, 'run.json');
    const config = ownConfig(d);
    assert.deepEqual(json(cli('new', '--config', config, '--run', run, '--subject', 'the tile')), { ok: true, status: 'plan' });
    assert.match(cli('new', '--config', config, '--run', run, '--subject', 'the tile').stderr, /a run exists/);
    assert.equal(json(cli('show', '--run', run)).subject, 'the tile');
    appendFileSync(config, '// edited\n');
    const res = cli('next', '--run', run);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /configuration changed since the run started/);
});

test('next, result, and a human-started dispatch drive the run through the CLI; output reaches a pipe whole', () => {
    const d = mkdtempSync(join(tmpdir(), 'looplock-bin-'));
    const run = join(d, 'run.json');
    cli('new', '--config', PRESET, '--run', run, '--subject', 'the tile');
    const dispatch = json(cli('next', '--run', run));
    assert.equal(dispatch.agent, 'planner');
    assert.equal(cli('dispatch', 'planner', '--run', run, '--text', 'why?').status, 2, 'the loop names no human route');
    const plan = join(d, 'plan.json');
    writeFileSync(plan, JSON.stringify({ steps: ['x'.repeat(100000)], obligations: [] }));
    writeFileSync(join(d, 'results', '1.json'), JSON.stringify({ status: 'ok', plan }));
    assert.deepEqual([json(cli('result', '--run', run)).stop, json(cli('show', '--run', run)).status], ['gate', 'gate']);
    assert.equal(json(cli('show', '--run', run, '--file', 'plan', '--pointer', '/steps/0')).value.length, 100000, 'piped output past 64 KiB arrives whole');
    assert.equal(json(cli('gate', 'gate', '--run', run, '--decision', 'approved')).status, 'build');
});
