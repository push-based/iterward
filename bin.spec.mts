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
    const refused = cli('new', '--config', config, '--run', run, '--subject', 'bad');
    assert.deepEqual([refused.status, refused.stderr], [2, 'mcp.json § looplock:\n  - autoApprove lists gate\n']);
    assert.equal(existsSync(dirname(run)), false);
    assert.deepEqual(json(cli('new', '--config', config, '--run', run, '--subject', 'c')), { ok: true, status: 'discovery', warnings: ['no linter'] });
    assert.match(cli('new', '--config', config, '--run', run, '--subject', 'c').stderr, /a run exists/);
    assert.match(cli('new', '--config', config, '--run', join(dirname(run), 'other.json'), '--subject', 'c').stderr, /holds files from an earlier run/);
});

test('next and result drive the run and save it; show prints its state; compile prints the loop with each outcome resolved', () => {
    const run = startedRun();
    const first = json(cli('next', '--run', run));
    assert.deepEqual([first.do, first.id, first.agent], ['dispatch', 1, 'scout']);
    doc(run, 'notes.md');
    assert.deepEqual([json(cli('result', '--run', run)).id, json(cli('show', '--run', run)).dispatches], [2, 2]);
    const compiled = json(cli('compile', '--config', JSON.parse(readFileSync(run, 'utf8')).config.path));
    assert.equal(compiled.config.artifacts.plan.guard, './hooks.mjs#planGuard');
    assert.deepEqual(compiled.config.steps.build.outcomes, { ok: 'verify-build', 'plan-invalidated': 'park', blocked: 'park' });
});

test('validate prints ok, or the grouped lines with exit 2; past 20,000 characters it prints 40 lines and the spill file', () => {
    const run = startedRun();
    assert.match(cli('validate', 'plan', '--run', run).stderr, /the run folder holds no plan\.md/);
    doc(run, 'plan.md');
    assert.deepEqual([cli('validate', 'plan', '--run', run).stdout, cli('validate', 'plan', '--run', run).status], ['ok\n', 0]);
    writeFileSync(join(dirname(run), 'errors.txt'), 'plan.md § Steps: step 2 names no file\nplan.md § Steps: step 3 has no check\nplan.md § Target: no path\n');
    const refused = cli('validate', 'plan', '--run', run);
    assert.deepEqual([refused.status, refused.stdout, refused.stderr], [2, '', 'plan.md § Steps:\n  - step 2 names no file\n  - step 3 has no check\nplan.md § Target:\n  - no path\n']);
    writeFileSync(join(dirname(run), 'errors.txt'), Array.from({ length: 400 }, (_, i) => `plan.md § Steps: step ${i} cites file f-${i}, which the repository doesn't hold`).join('\n'));
    const long = cli('validate', 'plan', '--run', run).stderr.trimEnd().split('\n');
    assert.equal(long.length, 41);
    const file = /^… 361 more lines in (.+)$/.exec(long[40])![1];
    assert.equal(file, join(dirname(run), 'out', 'validate.1.txt'));
    assert.equal(readFileSync(file, 'utf8').split('\n').length, 401, 'the file holds the whole list');
    doc(run, 'build.2.report.md');
    writeFileSync(join(dirname(run), 'build.10.report.md'), '---\nid: build.10.report.md\n---\n');
    writeFileSync(join(dirname(run), 'errors.txt'), '');
    assert.match(cli('validate', 'build-report', '--run', run).stderr, /build\.10\.report\.md § frontmatter:\n {2}- no status/, 'a per-attempt artifact validates its highest attempt');
});

test('answer records a JSON list all or none, and keeps the single form; both forms, neither, or a malformed list is a usage error', () => {
    const run = askedRun('Q-1', 'Q-2', 'Q-3');
    const answers = (...list: object[]) => cli('answer', '--run', run, '--answers', JSON.stringify(list));
    const bytes = readFileSync(run);
    const refused = answers({ id: 'Q-9', option: 'A', answer: 'a' }, { id: 'Q-2', option: 'B', answer: ' ' }, { id: 'Q-2', option: 'B', answer: 'b' });
    assert.deepEqual([refused.status, refused.stderr], [2, "Q-9:\n  - isn't in the ledger, which holds Q-1, Q-2, Q-3\nQ-2:\n  - needs the human's words as its answer, verbatim\n  - appears more than once\n"]);
    // The hook accepts Q-1 and refuses Q-2, so the run file stays byte for byte as it was.
    const midway = answers({ id: 'Q-1', option: 'A', answer: 'a' }, { id: 'Q-2', option: 'Z', answer: 'z' });
    assert.deepEqual([midway.status, midway.stderr], [2, "Q-2.md § Options:\n  - no option Z\nother:\n  - the answer to Q-2 was refused, so none of this call's answers was recorded\n"]);
    assert.deepEqual(readFileSync(run), bytes);
    for (const args of [[], ['--answers', '[]'], ['--answers', 'Q-1: A'], ['--answers', '[{"id":"Q-1"}]', '--id', 'Q-1'], ['--id', 'Q-1', '--option', 'A']]) {
        assert.equal(cli('answer', '--run', run, ...args).status, 1, args.join(' '));
    }
    assert.deepEqual(JSON.parse(answers({ id: 'Q-1', option: 'A', answer: 'a' }, { id: 'Q-2', option: 'custom', answer: "the human's own words" }).stdout), { ok: true, answered: [{ id: 'Q-1', chosen: 'A' }, { id: 'Q-2', chosen: 'custom' }], pending: ['Q-3'] });
    assert.deepEqual(json(cli('answer', '--run', run, '--id', 'Q-3', '--option', 'B', '--answer', 'b')), { ok: true, answered: [{ id: 'Q-3', chosen: 'B' }], pending: [] });
});

test('a changed hook module, or a module it imports, refuses every command of a started run', () => {
    const run = startedRun();
    const loop = dirname(JSON.parse(readFileSync(run, 'utf8')).config.path);
    appendFileSync(join(loop, 'status.mjs'), '// edited\n');
    for (const args of [['next'], ['result'], ['show'], ['validate', 'plan'], ['answer', '--id', 'Q-1', '--option', 'A', '--answer', 'a'], ['gate', 'gate', '--decision', 'approved'], ['transition', '--to', 'build', '--note', 'n']]) {
        const [cmd, ...rest] = args;
        const res = cli(cmd, ...(cmd === 'validate' || cmd === 'gate' ? [rest[0], '--run', run, ...rest.slice(1)] : ['--run', run, ...rest]));
        assert.equal(res.status, 2, cmd);
        assert.match(res.stderr, /the loop changed since the run started/, cmd);
    }
});
