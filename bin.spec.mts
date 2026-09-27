/**
 * node --test bin.spec.mts
 *
 * Proves the CLI's contract: exit codes, the preflight's refusal and warnings, `next` and `result` saving the
 * run, `validate`'s grouped lines and their spill file, `compile`, and the run's hold on its loop file and
 * hook modules.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { BIN, makeLoop, runPath, startedRun } from './mcp/spec/fixtures.mts';

const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const json = (res: { stdout: string }) => JSON.parse(res.stdout);
const doc = (run: string, file: string, status = 'ok') => writeFileSync(join(dirname(run), file), `---\nid: ${file}\nstatus: ${status}\n---\n`);

test('usage errors exit 1, refusals exit 2, --version prints the version package.json holds', () => {
    const config = join(makeLoop(), 'loop.json');
    assert.equal(cli('--version').stdout, `${JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')).version}\n`);
    assert.equal(cli('bogus').status, 1);
    assert.equal(cli('gate', '--run', 'x').status, 1, 'gate needs a gate name');
    assert.equal(cli('new', '--config', config).status, 1, 'new needs --run');
    assert.equal(cli('new', '--config', config, '--run', runPath()).status, 1, 'new needs the inputs the loop requires');
    assert.equal(cli('transition', '--run', 'x', '--to', 'build').status, 1, 'transition needs --note');
    assert.equal(cli('show', '--run', runPath()).status, 2, 'a missing run is a refusal');
});

test('new runs the preflight: an error refuses the run, grouped, and writes nothing; a warning is kept', () => {
    const config = join(makeLoop(), 'loop.json');
    const run = join(dirname(runPath()), 'runs', 'a', 'run.json');
    const refused = cli('new', '--config', config, '--run', run, '--component', 'bad');
    assert.deepEqual([refused.status, refused.stderr], [2, 'mcp.json § looplock:\n  - autoApprove lists gate\n']);
    assert.equal(existsSync(dirname(run)), false);
    assert.deepEqual(json(cli('new', '--config', config, '--run', run, '--component', 'c')), { ok: true, status: 'plan', warnings: ['no Sass compiler'] });
    assert.match(cli('new', '--config', config, '--run', run, '--component', 'c').stderr, /a run exists/);
    assert.match(cli('new', '--config', config, '--run', join(dirname(run), 'other.json'), '--component', 'c').stderr, /holds files from an earlier run/);
});

test('next and result drive the run and save it; show prints its state; compile prints the loop and what it inferred', () => {
    const run = startedRun();
    const first = json(cli('next', '--run', run));
    assert.deepEqual([first.do, first.id, first.agent], ['dispatch', 1, 'l2-discovery']);
    doc(run, 'EVID-discovery.md');
    assert.deepEqual([json(cli('result', '--run', run)).id, json(cli('show', '--run', run)).dispatches], [2, 2]);
    const compiled = json(cli('compile', '--config', JSON.parse(readFileSync(run, 'utf8')).config.path));
    assert.deepEqual(compiled.config.result, { module: './hooks.mjs', export: 'readResult' });
    assert.ok(compiled.inferred.includes('/gates/gate1/next'));
});

test('validate prints ok, or the grouped lines with exit 2; past 20,000 characters it prints 40 lines and the spill file', () => {
    const run = startedRun();
    assert.match(cli('validate', 'plan', '--run', run).stderr, /the run folder holds no plan\.md/);
    doc(run, 'plan.md');
    assert.deepEqual([cli('validate', 'plan', '--run', run).stdout, cli('validate', 'plan', '--run', run).status], ['ok\n', 0]);
    writeFileSync(join(dirname(run), 'errors.txt'), 'plan.md § Tokens: key fill cites no row\nplan.md § Tokens: key track has no default\nplan.md § Target: no prefix\n');
    const refused = cli('validate', 'plan', '--run', run);
    assert.deepEqual([refused.status, refused.stdout, refused.stderr], [2, '', 'plan.md § Tokens:\n  - key fill cites no row\n  - key track has no default\nplan.md § Target:\n  - no prefix\n']);
    writeFileSync(join(dirname(run), 'errors.txt'), Array.from({ length: 400 }, (_, i) => `plan.md § Tokens: key k${i} cites row R-${i}, which the matrix doesn't hold`).join('\n'));
    const long = cli('validate', 'plan', '--run', run).stderr.trimEnd().split('\n');
    assert.equal(long.length, 41);
    const file = /^… 361 more lines in (.+)$/.exec(long[40])![1];
    assert.equal(file, join(dirname(run), 'out', 'validate.1.txt'));
    assert.equal(readFileSync(file, 'utf8').split('\n').length, 401, 'the file holds the whole list');
    doc(run, 'verdict.2.md');
    doc(run, 'verdict.10.md', 'upheld');
    writeFileSync(join(dirname(run), 'errors.txt'), '');
    assert.equal(cli('validate', 'verdict', '--run', run).stdout, 'ok\n');
});

test('a changed hook module, or a module it imports, refuses every command of a started run', () => {
    const run = startedRun();
    const loop = dirname(JSON.parse(readFileSync(run, 'utf8')).config.path);
    appendFileSync(join(loop, 'status.mjs'), '// edited\n');
    for (const args of [['next'], ['result'], ['show'], ['validate', 'plan'], ['answer', '--id', 'RFC-1', '--option', 'A', '--answer', 'a'], ['gate', 'gate1', '--decision', 'approved'], ['transition', '--to', 'build', '--note', 'n']]) {
        const [cmd, ...rest] = args;
        const res = cli(cmd, ...(cmd === 'validate' || cmd === 'gate' ? [rest[0], '--run', run, ...rest.slice(1)] : ['--run', run, ...rest]));
        assert.equal(res.status, 2, cmd);
        assert.match(res.stderr, /the loop changed since the run started/, cmd);
    }
});
