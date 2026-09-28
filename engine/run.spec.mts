/**
 * node --test engine/run.spec.mts
 *
 * Proves the run record and its rules, through these modules alone: `new` with the loop's preflight, the
 * configuration hash a run keeps, `transition` with its edges, freeze checks, freeze drops, gate entry, and entry
 * validators, `gate` approve and reject, the question scan, and `answer` with `onAnswer`, its freeze, and a list
 * recorded all or none. The FDS-shaped fixture loop in `spec/loop/` runs with its hooks replaced by spies the tests set.
 */

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Run } from '../config.mts';
import { loadLoop } from '../load-config.mts';
import { type Ctx, context } from './context.mts';
import { answerQuestions } from './decisions/answer-questions.mts';
import { scanQuestions } from './decisions/scan-questions.mts';
import { approve } from './gates/approve.mts';
import { reject } from './gates/reject.mts';
import { FreezeError } from './run/freezes.mts';
import { humanEdges } from './run/human-edges.mts';
import { loadRun } from './run/load-run.mts';
import { newRun } from './run/new-run.mts';
import { saveRun } from './run/save-run.mts';
import { transition } from './run/transition.mts';
import { fileSha256 } from './util.mts';

const FIXTURE = fileURLToPath(new URL('../spec/loop/fds.loop.json', import.meta.url));
const HOOKS = ['preflight', 'readResult', 'route', 'onAnswer', 'guard', 'gateSummary', 'validator'];
/** Every hook of the loop calls the spy of its name, so a test sets what each hook does. */
const SPY = HOOKS.map((h) => `export const ${h} = (...a) => globalThis.looplockSpy.${h}(...a);`).join('\n');

type Calls = [string, ...any[]][];
let calls: Calls;
const spy = (over: Record<string, (...a: any[]) => any> = {}) => {
    const base: Record<string, (...a: any[]) => any> = {
        preflight: () => ({ errors: [], warnings: [] }),
        guard: () => [],
        validator: () => [],
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
    writeFileSync(join(dir, 'loop/fds.loop.json'), JSON.stringify(loop));
    writeFileSync(join(dir, 'loop/spy.mjs'), SPY);
    const ctx = context(await loadLoop(join(dir, 'loop/fds.loop.json')));
    const runPath = join(dir, 'runs/a/run.json');
    return { dir, ctx, runPath, write: (file: string, text = '---\nstatus: ok\n---\n') => writeFileSync(join(dir, 'runs/a', file), text) };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function started(): Promise<Env & { run: Run }> {
    const env = await setup();
    const run = await newRun(env.ctx, env.runPath, { component: 'packages/promo/x/progress-bar' }, join(env.dir, 'loop/fds.loop.json'));
    saveRun(env.ctx, env.runPath, run);
    return { ...env, run };
}

/** A started run at gate1, with the 3 frozen documents written. */
async function atGate(): Promise<Env & { run: Run }> {
    const env = await started();
    for (const f of ['EVID-discovery.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' });
    return env;
}

/** A run at build, after the gate approved it. */
async function approved(): Promise<Env & { run: Run }> {
    const env = await atGate();
    await approve(env.ctx, env.runPath, env.run, 'gate1', 'ship it');
    return env;
}

const rejects = (p: Promise<unknown>, expected: RegExp | typeof FreezeError) => assert.rejects(p, expected);

test('new stores the preflight warnings; a preflight error refuses the run and writes nothing', async () => {
    spy({ preflight: () => ({ errors: [], warnings: ['no Sass compiler: the scope falls back to a repository scan'] }) });
    const env = await started();
    assert.deepEqual(env.run.warnings, ['no Sass compiler: the scope falls back to a repository scan']);
    assert.deepEqual(calls[0][1].inputs, { component: 'packages/promo/x/progress-bar' });
    assert.equal(loadRun(env.ctx, env.runPath).status, 'plan');

    const other = await setup();
    spy({ preflight: () => ({ errors: ['mcp.json § looplock: autoApprove lists gate', 'mcp.json § looplock: autoApprove lists answer'], warnings: [] }) });
    await rejects(newRun(other.ctx, other.runPath, { component: 'c' }, 'loop.json'), /autoApprove lists gate\nmcp.json § looplock: autoApprove lists answer/);
    assert.equal(existsSync(other.runPath), false);
    await rejects(newRun(other.ctx, other.runPath, {}, 'loop.json'), /needs --component/);
});

test('a run refuses to load after its loop or a hook module changed', async () => {
    const env = await started();
    writeFileSync(join(env.dir, 'loop/spy.mjs'), `${SPY}\n// changed`);
    const changed = context(await loadLoop(join(env.dir, 'loop/fds.loop.json')));
    assert.throws(() => loadRun(changed, env.runPath), /the loop changed since the run started/);
});

test('the question scan takes new question files at the initial state, in numeric order', async () => {
    const env = await started();
    for (const f of ['RFC-10.md', 'RFC-2.md', 'RFC-1.md', 'notes.md', 'RFC-x.md']) env.write(f);
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run).map((q) => [q.id, q.file, q.status]), [['RFC-1', 'RFC-1.md', 'pending'], ['RFC-2', 'RFC-2.md', 'pending'], ['RFC-10', 'RFC-10.md', 'pending']]);
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run), []);
    env.write('RFC-3.md');
    assert.deepEqual(scanQuestions(env.ctx, env.runPath, env.run).map((q) => q.id), ['RFC-3']);
    assert.deepEqual(env.run.questions.map((q) => q.id), ['RFC-1', 'RFC-2', 'RFC-10', 'RFC-3']);

    const gate = await atGate();
    gate.write('RFC-1.md');
    assert.deepEqual(scanQuestions(gate.ctx, gate.runPath, gate.run), []);
});

test('answer calls onAnswer, resolves the question, and freezes its file; a throwing onAnswer records nothing', async () => {
    const env = await started();
    env.write('RFC-1.md');
    env.write('RFC-2.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'keep the purpose tokens' }]);
    const [, ctx] = calls.find(([h]) => h === 'onAnswer')!;
    assert.deepEqual([ctx.question, ctx.option, ctx.answer], [{ id: 'RFC-1', file: join(env.dir, 'runs/a/RFC-1.md') }, 'A', 'keep the purpose tokens']);
    assert.deepEqual({ ...env.run.questions[0], askedAt: 0, resolvedAt: 0 }, { id: 'RFC-1', file: 'RFC-1.md', status: 'resolved', chosen: 'A', answer: 'keep the purpose tokens', askedAt: 0, resolvedAt: 0 });
    assert.equal(env.run.freezes['RFC-1.md'].by, 'RFC-1');
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'B', answer: 'no' }]), /^Error: RFC-1: is resolved already; a new question with supersedes replaces it$/);
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-2', option: 'B' }]), /^Error: RFC-2: needs the human's words as its answer, verbatim$/);

    spy({ onAnswer: () => { throw new Error('RFC-2.md § Options: no option Z'); } });
    const before = JSON.stringify(env.run);
    await rejects(answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-2', option: 'Z', answer: 'z' }]), /no option Z/);
    assert.equal(JSON.stringify(env.run), before);

    const gate = await approved();
    await rejects(answerQuestions(gate.ctx, gate.runPath, gate.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]), /only allowed at status plan, not build/);
});

test('answer checks every entry before any hook runs, and refuses the call with every problem', async () => {
    const env = await started();
    for (const f of ['RFC-1.md', 'RFC-2.md', 'RFC-3.md']) env.write(f);
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]);
    calls = [];
    const before = JSON.stringify(env.run);
    const err = await answerQuestions(env.ctx, env.runPath, env.run, [
        { id: 'RFC-9', option: 'A', answer: 'a' },
        { id: 'RFC-1', option: 'A', answer: 'a' },
        { id: 'RFC-2', option: 'B', answer: ' ' },
        { id: 'RFC-3', option: 'A', answer: 'a' },
        { id: 'RFC-3', option: '', answer: 'b' },
    ]).catch((e) => e);
    assert.equal(err.message, [
        "RFC-9: isn't in the ledger, which holds RFC-1, RFC-2, RFC-3",
        'RFC-1: is resolved already; a new question with supersedes replaces it',
        "RFC-2: needs the human's words as its answer, verbatim",
        'RFC-3: needs an option key, or custom',
        'RFC-3: appears more than once',
    ].join('\n'));
    assert.deepEqual([calls, JSON.stringify(env.run)], [[], before]);
});

test('answer records a list in order, all or none: a hook that throws on an entry restores the run and names the entry', async () => {
    const env = await started();
    for (const f of ['RFC-1.md', 'RFC-2.md', 'RFC-3.md']) env.write(f);
    scanQuestions(env.ctx, env.runPath, env.run);
    spy({ onAnswer: ({ question, option }: any) => { if (option === 'Z') throw new Error(`${question.id}.md § Options: no option Z`); } });
    calls = [];
    const before = JSON.stringify(env.run);
    const err = await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }, { id: 'RFC-2', option: 'Z', answer: 'z' }, { id: 'RFC-3', option: 'A', answer: 'a' }]).catch((e) => e);
    assert.equal(err.message, "RFC-2.md § Options: no option Z\nthe answer to RFC-2 was refused, so none of this call's answers was recorded");
    assert.equal(JSON.stringify(env.run), before);
    assert.deepEqual(calls.map(([h, ctx]) => [h, ctx.question.id]), [['onAnswer', 'RFC-1'], ['onAnswer', 'RFC-2']]);

    const answered = await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-3', option: 'custom', answer: 'use the raw value' }, { id: 'RFC-1', option: 'A', answer: 'a' }]);
    assert.deepEqual(answered.map((q) => [q.id, q.status, q.chosen, q.answer]), [['RFC-3', 'resolved', 'custom', 'use the raw value'], ['RFC-1', 'resolved', 'A', 'a']]);
    assert.deepEqual(Object.entries(env.run.freezes).map(([f, x]) => [f, x.by]), [['RFC-3.md', 'RFC-3'], ['RFC-1.md', 'RFC-1']]);
});

test('gate entry refuses a pending question, runs the frozen artifacts\' guards with enter, and needs every frozen file', async () => {
    const env = await started();
    env.write('RFC-1.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    for (const f of ['EVID-discovery.md', 'plan.md']) env.write(f);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' }), /Gate 1 needs every question answered; pending: RFC-1/);
    assert.equal(calls.filter(([h]) => h === 'guard').length, 0);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' }), /^Error: Gate 1 freezes diff.md, and the run folder holds none$/);
    const guards = calls.filter(([h]) => h === 'guard');
    assert.deepEqual(guards.map(([, path, ctx]) => [path, ctx.event]), [[join(env.dir, 'runs/a/EVID-discovery.md'), 'enter'], [join(env.dir, 'runs/a/plan.md'), 'enter']]);

    spy({ guard: (path: string) => (path.endsWith('plan.md') ? ['plan.md § Tokens: key color-fill cites no row'] : []) });
    env.write('diff.md');
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' }), /^Error: plan.md § Tokens: key color-fill cites no row$/);
    // A guard can write a frozen file, as the plan guard writes diff.md.
    spy({ guard: (path: string) => (path.endsWith('plan.md') ? (writeFileSync(path.replace('plan.md', 'diff.md'), '# Diff\n'), []) : []) });
    await transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' });
    assert.equal(env.run.status, 'gate1');
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'action' }), /requires Gate 1 approval/);
});

test('a pending question refuses every move out of the initial state but blocked, also in a loop whose gate freezes nothing', async () => {
    const env = await setup((l) => { delete l.stages[1].freezes; });
    assert.equal(env.ctx.cfg.freezeGate, undefined);
    const run = await newRun(env.ctx, env.runPath, { component: 'packages/promo/x/progress-bar' }, join(env.dir, 'loop/fds.loop.json'));
    env.write('RFC-1.md');
    scanQuestions(env.ctx, env.runPath, run);
    await rejects(transition(env.ctx, env.runPath, run, 'gate1', { via: 'route' }), /^Error: leaving plan needs every question answered; pending: RFC-1$/);
    await rejects(transition(env.ctx, env.runPath, run, 'gate1', { via: 'action' }), /leaving plan needs every question answered/);
    assert.equal(run.status, 'plan');
    await answerQuestions(env.ctx, env.runPath, run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]);
    await transition(env.ctx, env.runPath, run, 'gate1', { via: 'route' });
    assert.equal(run.status, 'gate1');

    const parked = await started();
    parked.write('RFC-1.md');
    scanQuestions(parked.ctx, parked.runPath, parked.run);
    await transition(parked.ctx, parked.runPath, parked.run, 'blocked', { via: 'action', note: 'the planner stopped' });
    assert.equal(parked.run.status, 'blocked');
});

test('approval runs the guards with approve, records judged, and freezes the files; rejection needs a note and freezes nothing', async () => {
    const env = await atGate();
    calls = [];
    await approve(env.ctx, env.runPath, env.run, 'gate1', 'ship it');
    assert.deepEqual(calls.filter(([h]) => h === 'guard').map(([, , ctx]) => ctx.event), ['approve', 'approve']);
    const g = env.run.gates.gate1;
    assert.deepEqual([g.decision, g.note, Object.keys(g.history[0].judged)], ['approved', 'ship it', ['EVID-discovery.md', 'plan.md', 'diff.md']]);
    assert.deepEqual(Object.entries(env.run.freezes).map(([f, x]) => [f, x.by, x.sha256 === g.history[0].judged[f]]), [['EVID-discovery.md', 'gate1', true], ['plan.md', 'gate1', true], ['diff.md', 'gate1', true]]);
    assert.deepEqual({ ...env.run.history.at(-1), at: 0 }, { from: 'gate1', to: 'build', at: 0, note: 'ship it', human: true });

    const other = await atGate();
    await rejects(reject(other.ctx, other.runPath, other.run, 'gate1', ' '), /rejection needs --note/);
    await reject(other.ctx, other.runPath, other.run, 'gate1', 'group C2 is wrong');
    assert.deepEqual([other.run.status, other.run.gates.gate1.decision, other.run.freezes], ['plan', 'rejected', {}]);
    assert.equal(Object.keys(other.run.gates.gate1.history[0].judged).length, 3);
    await rejects(approve(other.ctx, other.runPath, other.run, 'gate1'), /needs status gate1, not plan/);
});

test('a transition runs the target\'s validator, and its errors refuse the move', async () => {
    const env = await approved();
    spy({ validator: () => ['checks.1.md § lint: 2 errors'] });
    const dispatch = { id: 1, name: 'build', agent: 'l2-builder', attempt: 1, document: '/r/build.1.report.md', openedAt: 'now' };
    await rejects(transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'action', dispatch }), /^Error: checks.1.md § lint: 2 errors$/);
    const [, ctx] = calls.find(([h]) => h === 'validator')!;
    assert.deepEqual([ctx.from, ctx.to, ctx.human, ctx.dispatch, ctx.runDir], ['build', 'verify-build', false, dispatch, join(env.dir, 'runs/a')]);
    assert.equal(env.run.status, 'build');
    await rejects(transition(env.ctx, env.runPath, env.run, 'integrate', { via: 'action' }), /illegal transition build → integrate/);
});

test('an edited frozen file throws a freeze error at an agent\'s move and refuses a human move', async () => {
    const env = await approved();
    await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'action' });
    env.write('plan.md', 'edited\n');
    const err = await transition(env.ctx, env.runPath, env.run, 'integrate', { via: 'action' }).catch((e) => e);
    assert.ok(err instanceof FreezeError);
    assert.equal(err.message, 'plan.md changed after Gate 1 froze it');
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'retry' }), FreezeError);
    // A move to blocked checks no freeze, so the run can park on it.
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'action', note: err.message });
    assert.equal(env.run.blockedFrom, 'verify-build');
});

test('a human transition takes only the compiled human edges, with a note, and dropping the freeze keeps the question freezes', async () => {
    const env = await started();
    env.write('RFC-1.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]);
    for (const f of ['EVID-discovery.md', 'plan.md', 'diff.md']) env.write(f);
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'human', note: 'go' }), /plan → gate1 is not a human move; from plan a human transition goes to no state/);
    await transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' });
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'go' }), /gate1 → build is not a human move/);
    await approve(env.ctx, env.runPath, env.run, 'gate1');
    await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'action' });
    assert.deepEqual(humanEdges(env.ctx, env.run), [{ to: 'plan', drops: 'gate1' }, { to: 'build', retries: true, resets: true }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'integrate', { via: 'human', note: 'looks fine' }), /verify-build → integrate is not a human move; from verify-build a human transition goes to plan, build/);
    await rejects(transition(env.ctx, env.runPath, env.run, 'plan', { via: 'human', note: '' }), /needs --note/);
    env.run.dispatches.push({ id: 1, name: 'verify-build', agent: 'l2-verifier', attempt: 1, document: 'verify-build.1.report.md', message: 'm', openedAt: 'now' });
    await rejects(transition(env.ctx, env.runPath, env.run, 'plan', { via: 'human', note: 'n' }), /dispatch 1 \(l2-verifier\) is open/);
    env.run.dispatches[0].closedAt = 'now';

    env.write('plan.md', 'the human edits the plan\n');
    await transition(env.ctx, env.runPath, env.run, 'plan', { via: 'human', note: 'the tokens need another purpose' });
    assert.deepEqual([env.run.status, Object.keys(env.run.freezes), env.run.gates.gate1.decision, env.run.gates.gate1.history.length], ['plan', ['RFC-1.md'], undefined, 1]);
    assert.deepEqual({ ...env.run.history.at(-1), at: 0 }, { from: 'verify-build', to: 'plan', at: 0, note: 'the tokens need another purpose', human: true });
    env.write('RFC-1.md', 'edited\n');
    await rejects(transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' }), /RFC-1.md changed after RFC-1 froze it/);
});

test('a blocked run leaves only by a human move: the resume edge or the edges of the state it blocked from', async () => {
    const env = await approved();
    await rejects(transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'action' }), /needs a note/);
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'action', note: 'l2-builder returned blocked' });
    assert.deepEqual([env.run.status, env.run.blockedFrom], ['blocked', 'build']);
    assert.deepEqual(humanEdges(env.ctx, env.run), [{ to: 'build', resumes: true, resets: true }, { to: 'plan', drops: 'gate1' }]);
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'action' }), /leaves only by a human transition/);
    await rejects(transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'human', note: 'n' }), /blocked → verify-build is not a human move/);
    await transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'fixed the host app' });
    assert.deepEqual([env.run.status, env.run.blockedFrom, env.run.history.at(-1)!.human], ['build', undefined, true]);
    saveRun(env.ctx, env.runPath, env.run);
    assert.equal(loadRun(env.ctx, env.runPath).status, 'build');
});

test('a human move into the initial state re-freezes the answered questions, so an edited or deleted RFC never traps the run', async () => {
    const env = await started();
    env.write('RFC-1.md');
    env.write('RFC-2.md');
    scanQuestions(env.ctx, env.runPath, env.run);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-1', option: 'A', answer: 'a' }]);
    await answerQuestions(env.ctx, env.runPath, env.run, [{ id: 'RFC-2', option: 'A', answer: 'a' }]);
    for (const f of ['EVID-discovery.md', 'plan.md', 'diff.md']) env.write(f);
    await transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' });
    await approve(env.ctx, env.runPath, env.run, 'gate1');
    env.write('RFC-1.md', 'a typo fix\n');
    const err = await transition(env.ctx, env.runPath, env.run, 'verify-build', { via: 'action' }).catch((e) => e);
    assert.ok(err instanceof FreezeError);
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'action', note: err.message });
    await rejects(transition(env.ctx, env.runPath, env.run, 'build', { via: 'human', note: 'resume' }), FreezeError);
    await transition(env.ctx, env.runPath, env.run, 'plan', { via: 'human', note: 'keep the typo fix' });
    assert.equal(env.run.status, 'plan');
    assert.equal(env.run.freezes['RFC-1.md'].sha256, fileSha256(join(env.dir, 'runs/a/RFC-1.md')));

    // The resume edge of a plan-blocked run re-freezes too, and a deleted RFC loses its freeze.
    env.write('RFC-1.md', 'a second edit\n');
    await transition(env.ctx, env.runPath, env.run, 'blocked', { via: 'action', note: 'RFC-1.md changed after RFC-1 froze it' });
    renameSync(join(env.dir, 'runs/a/RFC-2.md'), join(env.dir, 'RFC-2.md'));
    await transition(env.ctx, env.runPath, env.run, 'plan', { via: 'human', note: 'resume' });
    assert.deepEqual([env.run.status, Object.keys(env.run.freezes)], ['plan', ['RFC-1.md']]);

    // A gate rejection moves back to the initial state and re-freezes as well.
    await transition(env.ctx, env.runPath, env.run, 'gate1', { via: 'route' });
    env.write('RFC-1.md', 'a third edit\n');
    await rejects(approve(env.ctx, env.runPath, env.run, 'gate1'), FreezeError);
    await reject(env.ctx, env.runPath, env.run, 'gate1', 'RFC-1 changed');
    assert.equal(env.run.freezes['RFC-1.md'].sha256, fileSha256(join(env.dir, 'runs/a/RFC-1.md')));
});
