/**
 * node --test engine/run.spec.ts
 *
 * Proves the run record and its rules, through these modules alone: `new` with the loop's preflight, the
 * configuration hash a run keeps, `transition` with its human moves, freeze checks, freeze drops, gate entry, and
 * `onEnter`, `gate` approve and reject, the question scan, and `answer` with `onAnswer`, its freeze, and a list
 * recorded all or none. The fixture loop in `spec/loop/` runs with its hooks replaced by spies the tests set.
 */

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Run } from '../config.ts';
import { loadLoop } from '../load-config.ts';
import { type Ctx, context } from './context.ts';
import { answerQuestions } from './decisions/answer-questions.ts';
import { next } from './dispatch/next.ts';
import { scanQuestions } from './decisions/scan-questions.ts';
import { approve } from './gates/approve.ts';
import { reject } from './gates/reject.ts';
import { FreezeError } from './run/freezes.ts';
import { humanEdges } from './run/human-edges.ts';
import { loadRun } from './run/load-run.ts';
import { newRun } from './run/new-run.ts';
import { saveRun } from './run/save-run.ts';
import { transition } from './run/transition.ts';
import { fileSha256, VERSION, versionLine } from './util.ts';

const FIXTURE = fileURLToPath(new URL('../spec/loop/fixture.loop.json', import.meta.url));
const HOOKS = ['preflight', 'guard', 'planGuard', 'onAnswer', 'onEnter'];
/** Every hook of the loop calls the spy of its name, so a test sets what each hook does. */
const SPY = HOOKS.map((h) => `export const ${h} = (...a) => globalThis.looplockSpy.${h}(...a);`).join('\n');

type Calls = [string, ...any[]][];
let calls: Calls;
const spy = (over: Record<string, (...a: any[]) => any> = {}) => {
    const base: Record<string, (...a: any[]) => any> = {
        preflight: () => ({ errors: [], warnings: [] }),
        guard: () => ({ status: 'ok' }),
        planGuard: () => ({ status: 'ok' }),
        onEnter: () => [],
        onAnswer: () => {},
    };
    (globalThis as any).looplockSpy = Object.fromEntries(HOOKS.map((h) => [h, (...a: any[]) => {
        calls.push([h, ...a]);
        return (over[h] ?? base[h] ?? (() => undefined))(...a);
    }]));
};
beforeEach(() => {
    calls = [];
    spy();
});

/** A loop folder whose hooks are the spies, with its loop file changed by `edit`, and an empty run folder beside it. */
async function setup(edit: (loop: any) => void = () => {}) {
    const dir = mkdtempSync(join(tmpdir(), 'looplock-run-'));
    mkdirSync(join(dir, 'loop'));
    mkdirSync(join(dir, 'runs/a'), { recursive: true });
    const loop = JSON.parse(readFileSync(FIXTURE, 'utf8').replaceAll('./hooks.mts', './spy.mjs'));
    edit(loop);
    writeFileSync(join(dir, 'loop/fixture.loop.json'), JSON.stringify(loop));
    writeFileSync(join(dir, 'loop/spy.mjs'), SPY);
    const ctx = context(await loadLoop(join(dir, 'loop/fixture.loop.json')));
    const runPath = join(dir, 'runs/a/run.json');
    return { dir, ctx, runPath, write: (file: string, text = '---\nstatus: ok\n---\n') => writeFileSync(join(dir, 'runs/a', file), text) };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function started(): Promise<Env & { run: Run }> {
    const env = await setup();
    const run = await newRun(env.ctx, env.runPath, { subject: 'the progress bar' }, join(env.dir, 'loop/fixture.loop.json'));
    saveRun(env.ctx, env.runPath, run);
    return { ...env, run };
}

/** A started run at the gate, with its 3 frozen documents written. */
async function atGate(): Promise<Env & { run: Run }> {
    const env = await started();
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' });
    return env;
}

/** A run at build, after the gate approved it. */
async function approved(): Promise<Env & { run: Run }> {
    const env = await atGate();
    await approve(env.ctx, env.runPath, env.run, 'gate', 'ship it');
    return env;
}

const rejects = (p: Promise<unknown>, expected: RegExp | typeof FreezeError) => assert.rejects(p, expected);
const guardCalls = () => calls.filter(([h]) => h === 'guard' || h === 'planGuard');

test('new starts at the first step and stores the preflight warnings; a preflight error refuses the run and writes nothing', async () => {
    spy({ preflight: () => ({ errors: [], warnings: ['no linter: the checks skip lint'] }) });
    const env = await started();
    assert.deepEqual(env.run.warnings, ['no linter: the checks skip lint']);
    assert.deepEqual(calls[0][1].inputs, { subject: 'the progress bar' });
    assert.equal(loadRun(env.ctx, env.runPath).status, 'discovery');

    const other = await setup();
    spy({ preflight: () => ({ errors: ['mcp.json § looplock: autoApprove lists gate', 'mcp.json § looplock: autoApprove lists answer'], warnings: [] }) });
    await rejects(newRun(other.ctx, other.runPath, { subject: 'c' }, 'loop.json'), /autoApprove lists gate\nmcp.json § looplock: autoApprove lists answer/);
    assert.equal(existsSync(other.runPath), false);
    await rejects(newRun(other.ctx, other.runPath, {}, 'loop.json'), /needs --subject/);
});

test('a run refuses to load after its loop or a hook module changed', async () => {
    const env = await started();
    writeFileSync(join(env.dir, 'loop/spy.mjs'), `${SPY}\n// changed`);
    const changed = context(await loadLoop(join(env.dir, 'loop/fixture.loop.json')));
    assert.throws(() => loadRun(changed, env.runPath), /the loop changed since the run started/);
});

test('a run refuses to load under another version line of the engine, or with no engine, and loads under another patch version', async () => {
    assert.deepEqual(['0.4.0', '0.4.9-beta.1', '1.2.3'].map(versionLine), ['0.4', '0.4', '1']);
    const env = await started();
    assert.equal(env.run.engine, VERSION);
    const load = (engine?: string) => {
        writeFileSync(env.runPath, JSON.stringify({ ...env.run, engine }));
        return () => loadRun(env.ctx, env.runPath);
    };
    assert.equal(load(`${versionLine(VERSION)}.999`)().engine, `${versionLine(VERSION)}.999`);
    assert.throws(load('99.0.0'), new RegExp(`^Error: the run started under looplock 99.0.0, and this is looplock ${VERSION}; continue it with npx @push-based/looplock@99, or start a new run$`));
    assert.throws(load(undefined), /invalid run shape: engine must name the Looplock version that started the run/);
});

test('the question scan takes new question files at any state, in numeric order', async () => {
    const env = await started();
    for (const f of ['Q-10.md', 'Q-2.md', 'Q-1.md', 'notes.md', 'Q-x.md']) env.write(f);
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run).map((q) => [q.id, q.file, q.status]), [['Q-1', 'Q-1.md', 'pending'], ['Q-2', 'Q-2.md', 'pending'], ['Q-10', 'Q-10.md', 'pending']]);
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run), []);
    env.write('Q-3.md');
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run).map((q) => q.id), ['Q-3']);
    assert.deepEqual(env.run.questions.map((q) => q.id), ['Q-1', 'Q-2', 'Q-10', 'Q-3']);

    const built = await approved();
    built.write('Q-1.md');
    assert.deepEqual(scanQuestions(built.ctx, built.runPath, built.run).map((q) => q.id), ['Q-1']);
});

test('answer calls onAnswer, resolves the question, and freezes its file, at any status; a throwing onAnswer records nothing', async () => {
    const env = await started();
    env.write('Q-1.md');
    env.write('Q-2.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'keep the purpose values' }]);
    const [, ctx] = calls.find(([h]) => h === 'onAnswer')!;
    assert.deepEqual([ctx.question, ctx.option, ctx.answer], [{ id: 'Q-1', file: join(env.dir, 'runs/a/Q-1.md') }, 'A', 'keep the purpose values']);
    assert.deepEqual({ ...env.run.questions[0], askedAt: 0, resolvedAt: 0 }, { id: 'Q-1', file: 'Q-1.md', status: 'resolved', chosen: 'A', answer: 'keep the purpose values', askedAt: 0, resolvedAt: 0 });
    assert.equal(env.run.freezes['Q-1.md'].by, 'Q-1');
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'B', answer: 'no' }]), /^Error: Q-1: is resolved already$/);
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-2', option: 'B' }]), /^Error: Q-2: needs the human's words as its answer, verbatim$/);

    spy({ onAnswer: () => { throw new Error('Q-2.md § Options: no option Z'); } });
    const before = JSON.stringify(env.run);
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-2', option: 'Z', answer: 'z' }]), /no option Z/);
    assert.equal(JSON.stringify(env.run), before);

    spy();
    const built = await approved();
    built.write('Q-1.md');
    scanQuestions(built.ctx, built.runPath, built.run);
    await answerQuestions(built.ctx, built.runPath, built.run, [{ id: 'Q-1', option: 'A', answer: 'a' }]);
    assert.deepEqual([built.run.status, built.run.questions[0].status], ['build', 'resolved']);
});

test('answer checks every entry before any hook runs, and refuses the call with every problem', async () => {
    const env = await started();
    for (const f of ['Q-1.md', 'Q-2.md', 'Q-3.md']) env.write(f);
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'a' }]);
    calls = [];
    const before = JSON.stringify(env.run);
    const err = await answerQuestions(env.ctx, env.runPath, env.run, [
        { id: 'Q-9', option: 'A', answer: 'a' },
        { id: 'Q-1', option: 'A', answer: 'a' },
        { id: 'Q-2', option: 'B', answer: ' ' },
        { id: 'Q-3', option: 'A', answer: 'a' },
        { id: 'Q-3', option: '', answer: 'b' },
    ]).catch((e) => e);
    assert.equal(err.message, [
        "Q-9: isn't in the ledger, which holds Q-1, Q-2, Q-3",
        'Q-1: is resolved already',
        "Q-2: needs the human's words as its answer, verbatim",
        'Q-3: needs an option key, or custom',
        'Q-3: appears more than once',
    ].join('\n'));
    assert.deepEqual([calls, JSON.stringify(env.run)], [[], before]);
});

test('answer records a list in order, all or none: a hook that throws on an entry restores the run and names the entry', async () => {
    const env = await started();
    for (const f of ['Q-1.md', 'Q-2.md', 'Q-3.md']) env.write(f);
    scanQuestions(env.ctx, env.runPath, env.run);
    spy({ onAnswer: ({ question, option }: any) => { if (option === 'Z') throw new Error(`${question.id}.md § Options: no option Z`); } });
    calls = [];
    const before = JSON.stringify(env.run);
    const err = await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'a' }, { id: 'Q-2', option: 'Z', answer: 'z' }, { id: 'Q-3', option: 'A', answer: 'a' }]).catch((e) => e);
    assert.equal(err.message, "Q-2.md § Options: no option Z\nthe answer to Q-2 was refused, so none of this call's answers was recorded");
    assert.equal(JSON.stringify(env.run), before);
    assert.deepEqual(calls.map(([h, ctx]) => [h, ctx.question.id]), [['onAnswer', 'Q-1'], ['onAnswer', 'Q-2']]);

    const answered = await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-3', option: 'custom', answer: 'use the raw value' }, { id: 'Q-1', option: 'A', answer: 'a' }]);
    assert.deepEqual(answered.map((q) => [q.id, q.status, q.chosen, q.answer]), [['Q-3', 'resolved', 'custom', 'use the raw value'], ['Q-1', 'resolved', 'A', 'a']]);
    assert.deepEqual(Object.entries(env.run.freezes).map(([f, x]) => [f, x.by]), [['Q-3.md', 'Q-3'], ['Q-1.md', 'Q-1']]);
});

test('gate entry refuses a pending question, runs the frozen artifacts\' guards with enter, counts only their errors, and needs every frozen file', async () => {
    const env = await started();
    env.write('Q-1.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    for (const f of ['notes.md', 'plan.md']) env.write(f);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }), /Gate needs every question answered; pending: Q-1/);
    assert.equal(guardCalls().length, 0);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'a' }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }), /^Error: Gate freezes diff.md, and the run folder holds none$/);
    assert.deepEqual(guardCalls().map(([h, path, ctx]) => [h, path, ctx.event]), [['guard', join(env.dir, 'runs/a/notes.md'), 'enter'], ['planGuard', join(env.dir, 'runs/a/plan.md'), 'enter']]);

    spy({ planGuard: () => ({ errors: ['plan.md § Steps: step 2 names no file'] }) });
    env.write('diff.md');
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }), /^Error: plan.md § Steps: step 2 names no file$/);
    // A guard can write a frozen file, as the plan guard writes diff.md; a status at entry counts for nothing.
    spy({ planGuard: (path: string) => (writeFileSync(path.replace('plan.md', 'diff.md'), '# Diff\n'), { status: 'needs-decisions' }) });
    await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' });
    assert.equal(env.run.status, 'gate');
});

test('a pending question refuses a gate, but not a move into a step, a stop, or blocked', async () => {
    const env = await started();
    env.write('Q-1.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await transition(env.ctx, env.runPath, env.run, 'revision', { via: 'machine' });
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }), /^Error: Gate needs every question answered; pending: Q-1$/);
    await transition(env.ctx, env.runPath, env.run, 'release', { via: 'machine' });
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine', note: 'the planner stopped' });
    assert.deepEqual([env.run.status, env.run.blockedFrom], ['blocked', 'release']);
});

test('approval runs the guards with approve, records judged, freezes the files, and moves to gate.approve; rejection needs a note, freezes nothing, and moves to gate.reject', async () => {
    const env = await atGate();
    calls = [];
    await approve(env.ctx, env.runPath, env.run, 'gate', 'ship it');
    assert.deepEqual(guardCalls().map(([, , ctx]) => ctx.event), ['approve', 'approve']);
    const g = env.run.gates.gate;
    assert.deepEqual([g.decision, g.note, Object.keys(g.history[0].judged)], ['approved', 'ship it', ['notes.md', 'plan.md', 'diff.md']]);
    assert.deepEqual(Object.entries(env.run.freezes).map(([f, x]) => [f, x.by, x.sha256 === g.history[0].judged[f]]), [['notes.md', 'gate', true], ['plan.md', 'gate', true], ['diff.md', 'gate', true]]);
    assert.deepEqual({ ...env.run.history.at(-1), at: 0 }, { from: 'gate', to: 'build', at: 0, note: 'ship it', human: true });

    const other = await atGate();
    await rejects(reject(other.ctx, other.runPath, other.run, 'gate', ' '), /rejection needs --note/);
    await reject(other.ctx, other.runPath, other.run, 'gate', 'group C2 is wrong');
    assert.deepEqual([other.run.status, other.run.gates.gate.decision, other.run.freezes], ['revision', 'rejected', {}]);
    assert.equal(Object.keys(other.run.gates.gate.history[0].judged).length, 3);
    await rejects(approve(other.ctx, other.runPath, other.run, 'gate'), /needs status gate, not revision/);
});

test('a transition runs the target\'s onEnter, and its errors refuse the move', async () => {
    const env = await approved();
    spy({ onEnter: () => ['checks.1.md § lint: 2 errors'] });
    const dispatch = { id: 1, name: 'build', agent: 'builder', attempt: 1, document: '/r/build.1.report.md', openedAt: 'now' };
    await rejects(transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'machine', dispatch }), /^Error: checks.1.md § lint: 2 errors$/);
    const [, ctx] = calls.find(([h]) => h === 'onEnter')!;
    assert.deepEqual([ctx.from, ctx.to, ctx.human, ctx.dispatch, ctx.runDir], ['build', 'verify-build', false, dispatch, join(env.dir, 'runs/a')]);
    assert.equal(env.run.status, 'build');
});

test('an edited frozen file throws a freeze error at an agent\'s move and refuses a human move', async () => {
    const env = await approved();
    await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'machine' });
    env.write('plan.md', 'edited\n');
    const err = await transition(env.ctx, env.runPath, env.run, 'release', { via: 'machine' }).catch((e) => e);
    assert.ok(err instanceof FreezeError);
    assert.equal(err.message, 'plan.md changed after Gate froze it');
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'retry' }), FreezeError);
    // A move to blocked checks no freeze, so the run can park on it.
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine', note: err.message });
    assert.equal(env.run.blockedFrom, 'verify-build');
});

test('a human transition takes only the loop\'s human moves, with a note; a move into a step that writes a frozen artifact drops that gate\'s freeze and keeps the question freezes', async () => {
    const env = await started();
    env.write('Q-1.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'a' }]);
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'human', note: 'go' }), /discovery → gate is not a human move; from discovery a human transition goes to no state/);
    await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' });
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'go' }), /gate → build is not a human move/);
    await approve(env.ctx, env.runPath, env.run, 'gate');
    await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'machine' });
    assert.deepEqual(humanEdges(env.ctx, env.run), [{ to: 'revision', drops: 'gate' }, { to: 'build' }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'release', { via: 'human', note: 'looks fine' }), /verify-build → release is not a human move; from verify-build a human transition goes to revision, build/);
    await rejects(transition(env.ctx, env.runPath, env.run, 'revision', { via: 'human', note: '' }), /needs --note/);
    env.run.dispatches.push({ id: 1, name: 'verify-build', agent: 'verifier', attempt: 1, document: 'verify-build.1.report.md', message: 'm', openedAt: 'now' });
    await rejects(transition(env.ctx, env.runPath, env.run, 'revision', { via: 'human', note: 'n' }), /dispatch 1 \(verifier\) is open/);
    env.run.dispatches[0].closedAt = 'now';

    await transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'build once more' });
    assert.deepEqual(Object.keys(env.run.freezes), ['Q-1.md', 'notes.md', 'plan.md', 'diff.md'], 'build writes no frozen artifact, so the freeze stays');
    env.write('plan.md', 'the human edits the plan\n');
    await transition(env.ctx, env.runPath, env.run, 'revision', { via: 'human', note: 'the steps need another order' });
    assert.deepEqual([env.run.status, Object.keys(env.run.freezes), env.run.gates.gate.decision, env.run.gates.gate.history.length], ['revision', ['Q-1.md'], undefined, 1]);
    assert.deepEqual({ ...env.run.history.at(-1), at: 0 }, { from: 'build', to: 'revision', at: 0, note: 'the steps need another order', human: true });
    env.write('Q-1.md', 'edited\n');
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }), /Q-1.md changed after Q-1 froze it/);
});

test('a rejection at a gate the run entered again keeps the decision and note it records, and drops the earlier approval\'s freeze', async () => {
    const env = await setup((l) => { l.machine['verify-build.fail'] = 'gate'; });
    const run = await newRun(env.ctx, env.runPath, { subject: 's' }, join(env.dir, 'loop/fixture.loop.json'));
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, run, 'gate', { via: 'machine' });
    await approve(env.ctx, env.runPath, run, 'gate', 'ship it');
    await transition(env.ctx, env.runPath, run, 'verify-build', { via: 'machine' });
    await transition(env.ctx, env.runPath, run, 'gate', { via: 'machine' });
    await reject(env.ctx, env.runPath, run, 'gate', 'step 3 is wrong');
    const g = run.gates.gate;
    assert.deepEqual([run.status, g.decision, g.note, g.history.length, run.freezes], ['revision', 'rejected', 'step 3 is wrong', 2, {}]);
});

/** A run of the loop with a second gate, Diff review, that freezes diff.md, an artifact code writes; both gates approved, at build. */
async function twoGates(edit: (loop: any) => void = () => {}) {
    const env = await setup((l) => {
        l.gates.gate.freezes = ['notes', 'plan'];
        l.gates['diff-review'] = { label: 'Diff review', freezes: ['diff'] };
        Object.assign(l.machine, { 'gate.approve': 'diff-review', 'diff-review.approve': 'build', 'diff-review.reject': 'revision' });
        l.human.revision = ['diff-review'];
        edit(l);
    });
    const run = await newRun(env.ctx, env.runPath, { subject: 's' }, join(env.dir, 'loop/fixture.loop.json'));
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, run, 'gate', { via: 'machine' });
    await approve(env.ctx, env.runPath, run, 'gate');
    return { ...env, run };
}

test('a human move into a gate drops that gate\'s freeze, so a changed artifact that code writes never traps the run', async () => {
    const env = await twoGates();
    await approve(env.ctx, env.runPath, env.run, 'diff-review');
    await transition(env.ctx, env.runPath, env.run, 'revision', { via: 'human', note: 'split step 2' });
    env.write('plan.md', 'the plan, split\n');
    env.write('diff.md', 'the diff of the split plan\n');
    const err = await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' }).catch((e) => e);
    assert.ok(err instanceof FreezeError);
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine', note: err.message });
    assert.deepEqual(humanEdges(env.ctx, env.run), [{ to: 'revision', resumes: true }, { to: 'diff-review', drops: 'diff-review' }]);
    await transition(env.ctx, env.runPath, env.run, 'diff-review', { via: 'human', note: 'judge the new diff' });
    const g = env.run.gates['diff-review'];
    assert.deepEqual([env.run.status, Object.keys(env.run.freezes), g.decision, g.history.length], ['diff-review', [], undefined, 1]);
});

test('a gate stop lists the freeze its approval drops', async () => {
    const env = await twoGates((l) => { l.machine['diff-review.approve'] = 'revision'; });
    const stop: any = await next(env.ctx, env.runPath, env.run);
    const inRun = (f: string) => join(env.dir, 'runs/a', f);
    assert.deepEqual(stop.moves[0], { call: 'gate', gate: 'diff-review', decision: 'approved', to: 'revision', freezes: [inRun('diff.md')], drops: { gate: 'gate', files: [inRun('notes.md'), inRun('plan.md')] } });
});

test('a blocked run leaves only by a human move: the resume into the step it parked from, or that step\'s human moves', async () => {
    const env = await approved();
    await rejects(transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine' }), /needs a note/);
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine', note: 'builder returned blocked' });
    assert.deepEqual([env.run.status, env.run.blockedFrom], ['blocked', 'build']);
    assert.deepEqual(humanEdges(env.ctx, env.run), [{ to: 'build', resumes: true }, { to: 'revision', drops: 'gate' }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'machine' }), /leaves only by a human transition/);
    await rejects(transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'human', note: 'n' }), /blocked → verify-build is not a human move/);
    await transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'fixed the host app' });
    assert.deepEqual([env.run.status, env.run.blockedFrom, env.run.history.at(-1)!.human], ['build', undefined, true]);
    saveRun(env.ctx, env.runPath, env.run);
    assert.equal(loadRun(env.ctx, env.runPath).status, 'build');
});

test('every human move re-freezes the answered questions, so an edited or deleted question file never traps the run', async () => {
    const env = await started();
    env.write('Q-1.md');
    env.write('Q-2.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'a' }]);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'Q-2', option: 'A', answer: 'a' }]);
    for (const f of ['notes.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' });
    await approve(env.ctx, env.runPath, env.run, 'gate');
    env.write('Q-1.md', 'a typo fix\n');
    const err = await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'machine' }).catch((e) => e);
    assert.ok(err instanceof FreezeError);
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'machine', note: err.message });
    renameSync(join(env.dir, 'runs/a/Q-2.md'), join(env.dir, 'Q-2.md'));
    await transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'keep the typo fix' });
    assert.deepEqual([env.run.status, env.run.freezes['Q-1.md'].sha256, env.run.freezes['Q-2.md']], ['build', fileSha256(join(env.dir, 'runs/a/Q-1.md')), undefined]);

    // A gate rejection re-freezes as well.
    await transition(env.ctx, env.runPath, env.run, 'revision', { via: 'human', note: 'replan' });
    await transition(env.ctx, env.runPath, env.run, 'gate', { via: 'machine' });
    env.write('Q-1.md', 'a second edit\n');
    await rejects(approve(env.ctx, env.runPath, env.run, 'gate'), FreezeError);
    await reject(env.ctx, env.runPath, env.run, 'gate', 'Q-1 changed');
    assert.equal(env.run.freezes['Q-1.md'].sha256, fileSha256(join(env.dir, 'runs/a/Q-1.md')));
});
