/**
 * node --test bin.spec.ts
 *
 * Proves the CLI's contract: exit codes, the preflight's refusal and warnings, `next` and `result` saving the
 * run, `result --id` and `closed`, `dispatch`, `validate`'s grouped lines and their spill file, `answer`'s two
 * forms and its all-or-none list, `compile`, the run's hold on its loop file and hook modules,
 * and one mutating command at a time: the lock and the whole-file save.
 */

import assert from 'node:assert/strict';
import { type ChildProcess, execFile, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { spill } from './engine.ts';
import { askedRun, BIN, makeLoop, runPath, startedRun } from './mcp/spec/fixtures.ts';

const cli = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
const json = (res: { stdout: string }) => JSON.parse(res.stdout);
const doc = (run: string, file: string, status = 'ok') => writeFileSync(join(dirname(run), file), `---\nid: ${file}\nstatus: ${status}\n---\n`);

/** The background children, stopped when the file's tests end, so a failed assertion leaves none running. */
const children: ChildProcess[] = [];
after(() => children.forEach((c) => c.kill('SIGKILL')));

/** The CLI in its own process, without waiting for it: `done` resolves with its exit status and output. */
function background(...args: string[]) {
    let child!: ChildProcess;
    const done = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        child = execFile(process.execPath, [BIN, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout, stderr }));
    });
    children.push(child);
    return { child, done };
}

/** The guard calls of a run whose folder holds `wait.txt`: one `guard.<PID>.txt` file per call. */
const guardCalls = (run: string) => readdirSync(dirname(run)).filter((f) => /^guard\.\d+\.txt$/.test(f));
/** The temporary files a save left in the run folder. */
const tmpFiles = (run: string) => readdirSync(dirname(run)).filter((f) => f.endsWith('.tmp'));

/** Wait until `ok` holds, for up to 10 seconds. */
async function until(ok: () => boolean) {
    for (let i = 0; i < 500 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(ok(), 'timed out');
}

/** A run at its first dispatch with notes.md written, whose guard calls wait `ms` milliseconds each. */
function slowRun(ms: number): string {
    const run = startedRun();
    assert.equal(cli('next', '--run', run).status, 0);
    doc(run, 'notes.md');
    writeFileSync(join(dirname(run), 'wait.txt'), String(ms));
    return run;
}

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
    for (const args of [['next'], ['result'], ['show'], ['dispatch'], ['validate', 'plan'], ['answer', '--id', 'Q-1', '--option', 'A', '--answer', 'a'], ['gate', 'gate', '--decision', 'approved'], ['transition', '--to', 'build', '--note', 'n']]) {
        const [cmd, ...rest] = args;
        const res = cli(cmd, ...(cmd === 'validate' || cmd === 'gate' ? [rest[0], '--run', run, ...rest.slice(1)] : ['--run', run, ...rest]));
        assert.equal(res.status, 2, cmd);
        assert.match(res.stderr, /the loop changed since the run started/, cmd);
    }
});

test('result --id refuses before any hook unless dispatch N is open, and result prints the dispatch it closed', () => {
    const run = startedRun();
    writeFileSync(join(dirname(run), 'wait.txt'), '0');
    assert.deepEqual([cli('result', '--run', run, '--id', '1').stderr, cli('result', '--run', run, '--id', 'x').status], ["other:\n  - dispatch 1 isn't open (no open dispatch)\n", 1]);
    cli('next', '--run', run);
    doc(run, 'notes.md');
    const bytes = readFileSync(run);
    const wrong = cli('result', '--run', run, '--id', '2');
    assert.deepEqual([wrong.status, wrong.stderr, guardCalls(run)], [2, "other:\n  - dispatch 2 isn't open (dispatch 1 is)\n", []]);
    assert.deepEqual(readFileSync(run), bytes);
    const closed = json(cli('result', '--run', run, '--id', '1'));
    assert.deepEqual([closed.closed, closed.do, closed.id, guardCalls(run).length], [{ id: 1, step: 'discovery', outcome: 'ok' }, 'dispatch', 2, 1]);
    assert.deepEqual(json(cli('result', '--run', run)).closed, { id: 2, step: 'draft', outcome: 'unusable' }, 'the planner wrote no plan.md');
});

test('dispatch prints the open dispatch with its message byte for byte, refuses with none open, and writes nothing', () => {
    const run = startedRun();
    assert.deepEqual([cli('dispatch', '--run', run).status, cli('dispatch', '--run', run).stderr], [2, 'other:\n  - no open dispatch\n']);
    const opened = json(cli('next', '--run', run));
    const [bytes, mtime] = [readFileSync(run), statSync(run).mtimeMs];
    const res = cli('dispatch', '--run', run);
    assert.equal(res.stdout.split('\n').length, 2, 'one line of JSON');
    assert.deepEqual(json(res), { id: 1, step: 'discovery', agent: 'scout', attempt: 1, document: join(dirname(run), 'notes.md'), openedAt: JSON.parse(String(bytes)).dispatches[0].openedAt, message: opened.message });
    assert.deepEqual([readFileSync(run), statSync(run).mtimeMs, readdirSync(dirname(run))], [bytes, mtime, ['run.json']]);
});

test('a spill keeps 40 lines and cuts each kept line past 400 characters; the file holds the whole text', () => {
    const dir = dirname(runPath());
    const text = ['x'.repeat(51_965), ...Array.from({ length: 40 }, (_, i) => `line ${i + 2}`)].join('\n');
    const out = spill(dir, 'validate', text).split('\n');
    assert.deepEqual([out.length, out[0], out[39], out[40]], [41, `${'x'.repeat(400)}…`, 'line 40', `… 1 more lines in ${join(dir, 'out', 'validate.1.txt')}`]);
    assert.equal(readFileSync(join(dir, 'out', 'validate.1.txt'), 'utf8'), text);
    // Three lines, one cut: the trailer still names the file, and the cut keeps a surrogate pair whole.
    const short = spill(dir, 'validate', ['a', `${'y'.repeat(399)}😀${'z'.repeat(25_000)}`, 'c'].join('\n')).split('\n');
    assert.deepEqual(short, ['a', `${'y'.repeat(399)}😀…`, 'c', `… the whole text is in ${join(dir, 'out', 'validate.2.txt')}`]);
});

test('an empty lock is stale after a short wait, and the next command takes it over', () => {
    const run = startedRun();
    writeFileSync(`${run}.lock`, '');
    assert.equal(cli('next', '--run', run).status, 0);
    assert.equal(existsSync(`${run}.lock`), false);
});

test('of two concurrent results, exactly one wins, and the other is refused before any hook runs', async () => {
    const run = slowRun(1500);
    const first = background('result', '--run', run);
    await until(() => guardCalls(run).length === 1);
    const second = await background('result', '--run', run).done;
    assert.equal((await first.done).status, 0);
    assert.equal(second.status, 2);
    assert.match(second.stderr, /^other:\n {2}- another looplock command \(result, pid \d+, since \S+\) holds (\S+run\.json\.lock); run this one again after it ends, or delete \1 when no such process runs\n$/);
    assert.deepEqual([guardCalls(run).length, json(cli('show', '--run', run)).dispatches, existsSync(`${run}.lock`)], [1, 2, false]);
});

test('next during a running result is refused and saves nothing, and the run stays consistent', async () => {
    const run = slowRun(1500);
    const bytes = readFileSync(run);
    const running = background('result', '--run', run);
    await until(() => guardCalls(run).length === 1);
    const refused = cli('next', '--run', run);
    assert.deepEqual([refused.status, readFileSync(run)], [2, bytes]);
    assert.match(refused.stderr, /another looplock command \(result, pid \d+/);
    assert.equal((await running.done).status, 0);
    assert.deepEqual([json(cli('show', '--run', run)).dispatches, json(cli('next', '--run', run)).id], [2, 2]);
});

test('a command stopped by SIGKILL leaves run.json whole, the next command takes over its stale lock, and a save renames a new file over run.json', async () => {
    const run = slowRun(60_000);
    const bytes = readFileSync(run);
    const killed = background('result', '--run', run);
    await until(() => guardCalls(run).length === 1);
    killed.child.kill('SIGKILL');
    await killed.done;
    assert.deepEqual([readFileSync(run), JSON.parse(readFileSync(`${run}.lock`, 'utf8')).command], [bytes, 'result']);
    rmSync(join(dirname(run), 'wait.txt'));
    const inode = statSync(run).ino;
    assert.deepEqual(json(cli('result', '--run', run)).closed, { id: 1, step: 'discovery', outcome: 'ok' });
    assert.deepEqual([statSync(run).ino === inode, existsSync(`${run}.lock`), tmpFiles(run)], [false, false, []]);
});

