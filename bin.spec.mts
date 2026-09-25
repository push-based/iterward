/**
 * node --test tools/scripts/looplock/bin.spec.mts
 *
 * Proves the CLI's contract: exit codes, flag parsing, the run's hold on its configuration file, the
 * human-started dispatch, and output that reaches a pipe whole.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    const run = join(d, 'run', 'run.json');
    const config = ownConfig(d);
    assert.deepEqual(json(cli('new', '--config', config, '--run', run, '--subject', 'the tile')), { ok: true, status: 'plan' });
    assert.match(cli('new', '--config', config, '--run', run, '--subject', 'the tile').stderr, /a run exists/);
    assert.match(cli('new', '--config', config, '--run', join(d, 'run.json'), '--subject', 'the tile').stderr, /holds files from an earlier run/);
    assert.equal(json(cli('show', '--run', run)).subject, 'the tile');
    appendFileSync(config, '// edited\n');
    const res = cli('next', '--run', run);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /configuration changed since the run started/);
});

test('preflight: a failing row refuses the run and leaves its folder empty, a warning row only reports; the run holds on to every file its configuration imports', () => {
    const d = mkdtempSync(join(tmpdir(), 'looplock-bin-'));
    spawnSync('git', ['init', '-q'], { cwd: d });
    writeFileSync(join(d, 'loop.mts'), `import preset from ${JSON.stringify(pathToFileURL(PRESET).href)};\nimport { rows } from './rows.mjs';\nexport default { ...preset, preflight: rows };\n`);
    // The stylesheet line inside a string is not an import the scan follows.
    writeFileSync(join(d, 'rows.mjs'), "import { existsSync } from 'node:fs';\nconst line = `@import '../../missing/partial';`;\nexport const rows = ({ fact }) => {\n    fact('marker', 'test -e marker', existsSync('marker') ? 'pass' : 'fail', 'the marker file');\n    fact('advice', 'test -e advice', existsSync('advice') ? 'pass' : 'fail', 'the advice file', { warn: true });\n};\n");
    const cliIn = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: d });
    const run = join(d, 'runs', 'a', 'run.json');
    const refused = cliIn('new', '--config', 'loop.mts', '--run', run, '--subject', 'the tile');
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /^preflight refuses the run: marker fail \(/);
    assert.equal(existsSync(join(d, 'runs', 'a')), false, 'a refused run writes nothing in its folder');
    writeFileSync(join(d, 'marker'), '');
    const made = json(cliIn('new', '--config', 'loop.mts', '--run', run, '--subject', 'the tile'));
    assert.deepEqual([made.ok, made.warnings.map((w: any) => [w.row, w.status])], [true, [['advice', 'fail']]]);
    assert.equal(cliIn('next', '--run', run).status, 0);
    appendFileSync(join(d, 'rows.mjs'), '// edited\n');
    assert.match(cliIn('next', '--run', run).stderr, /configuration changed since the run started \(loop\.mts or a file it imports\)/);
});

test('next, result, and a human-started dispatch drive the run through the CLI; a large output spills whole to a file', () => {
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
    const shown = json(cli('show', '--run', run, '--file', 'plan', '--pointer', '/steps'));
    assert.deepEqual([shown.pointer, shown.value.spilled, shown.value.length], ['/steps', '/value', 1], 'the printed view names what it left out');
    assert.equal(JSON.parse(readFileSync(shown.file, 'utf8')).value[0].length, 100000, 'the file holds the whole output');
    assert.equal(json(cli('show', '--run', run, '--file', shown.file, '--pointer', '/value/0')).value.spilled, '/value', 'show reads a spilled file');
    assert.equal(cli('show', '--run', run, '--file', plan).status, 2, 'show reads only artifacts, the draft, and spilled files');
    assert.equal(json(cli('gate', 'gate', '--run', run, '--decision', 'approved')).status, 'build');
});
