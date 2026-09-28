/**
 * node --test bin.spec.mts
 *
 * Proves the CLI's contract: exit codes, the preflight's refusal and warnings, `next` and `result` saving the
 * run, `validate`'s grouped lines and their spill file, `answer`'s two forms and its all-or-none list, `compile`,
 * and the run's hold on its loop file and hook modules.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { askedRun, BIN, makeLoop, runPath, startedRun } from './mcp/spec/fixtures.mts';

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

test('answer records a JSON list all or none, and keeps the single form; both forms, neither, or a malformed list is a usage error', () => {
    const run = askedRun('RFC-1', 'RFC-2', 'RFC-3');
    const answers = (...list: object[]) => cli('answer', '--run', run, '--answers', JSON.stringify(list));
    const bytes = readFileSync(run);
    const refused = answers({ id: 'RFC-9', option: 'A', answer: 'a' }, { id: 'RFC-2', option: 'B', answer: ' ' }, { id: 'RFC-2', option: 'B', answer: 'b' });
    assert.deepEqual([refused.status, refused.stderr], [2, "RFC-9:\n  - isn't in the ledger, which holds RFC-1, RFC-2, RFC-3\nRFC-2:\n  - needs the human's words as its answer, verbatim\n  - appears more than once\n"]);
    // The hook accepts RFC-1 and refuses RFC-2, so the run file stays byte for byte as it was.
    const midway = answers({ id: 'RFC-1', option: 'A', answer: 'a' }, { id: 'RFC-2', option: 'Z', answer: 'z' });
    assert.deepEqual([midway.status, midway.stderr], [2, "RFC-2.md § Options:\n  - no option Z\nother:\n  - the answer to RFC-2 was refused, so none of this call's answers was recorded\n"]);
    assert.deepEqual(readFileSync(run), bytes);
    for (const args of [[], ['--answers', '[]'], ['--answers', 'RFC-1: A'], ['--answers', '[{"id":"RFC-1"}]', '--id', 'RFC-1'], ['--id', 'RFC-1', '--option', 'A']]) {
        assert.equal(cli('answer', '--run', run, ...args).status, 1, args.join(' '));
    }
    assert.deepEqual(JSON.parse(answers({ id: 'RFC-1', option: 'A', answer: 'a' }, { id: 'RFC-2', option: 'custom', answer: "the human's own words" }).stdout), { ok: true, answered: [{ id: 'RFC-1', chosen: 'A' }, { id: 'RFC-2', chosen: 'custom' }], pending: ['RFC-3'] });
    assert.deepEqual(json(cli('answer', '--run', run, '--id', 'RFC-3', '--option', 'B', '--answer', 'b')), { ok: true, answered: [{ id: 'RFC-3', chosen: 'B' }], pending: [] });
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
