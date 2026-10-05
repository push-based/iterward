/**
 * node --test engine/dispatch.spec.mts
 *
 * Proves `next` and `result` on the fixture loop with spy hooks: the standard message, document freshness, the
 * guard's status and the outcomes, guard refusals and their Fixes, the `opens` limit, the question scan and
 * `ask`, `onEnter` refusals, `park`, a refused gate entry, and diff.md as an artifact code writes and the gate
 * freezes.
 */

import assert from 'node:assert/strict';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

import { atGate, building, calls, spy, started, tick } from './dispatch/spec/spy-loop.mts';
import { fileSha256 } from './util.mts';

beforeEach(() => spy());

/** The standard message of a step. */
const message = (runPath: string, step: string, document: string, note = 'none', fixes = 'Fixes: none') =>
    [`Step: ${step}`, `Run: ${runPath}`, `Document: ${document}`, 'Inputs:', '  subject: the progress bar', '  design: none', `Note: ${note}`, fixes].join('\n');

test('every step opens with the standard message: the step, the run, the document, every input with none for an absent one, the note, and the fixes', async () => {
    const env = await started();
    const first = await env.next();
    assert.deepEqual(first, { do: 'dispatch', id: 1, agent: 'scout', message: message(env.runPath, 'discovery', join(env.runDir, 'notes.md')) });
    assert.deepEqual(await env.next(), first, 'an open dispatch comes back unchanged');
    assert.deepEqual(env.run.dispatches[0].document, join(env.runDir, 'notes.md'));
});

test('the note is the latest human move after the step last opened, and none after that; a multi-line note stays one field', async () => {
    const env = await building('ship it\nbut keep the old fill');
    assert.equal(env.run.dispatches.at(-1)!.message, message(env.runPath, 'build', join(env.runDir, 'build.1.report.md'), 'ship it\n  but keep the old fill'));
    env.write('build.1.report.md', 'blocked');
    await env.result();
    await tick();
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'the host app builds again' });
    assert.match((await env.next()).message, /^Document: .*build\.2\.report\.md\n(.|\n)*Note: the host app builds again\nFixes: none$/m);
    env.write('build.2.report.md', 'ok');
    spy({ onEnter: () => ['checks.1.md § lint: 2 errors'] });
    assert.equal((await env.result()).message, message(env.runPath, 'build', join(env.runDir, 'build.3.report.md'), 'none', 'Fixes:\nchecks.1.md § lint:\n  - 2 errors'));
});

test('result: a missing or stale document is unusable and opens the step again; the fourth open since the last human move parks', async () => {
    const env = await started();
    await env.next();
    const again = await env.result();
    assert.equal(again.message, message(env.runPath, 'discovery', join(env.runDir, 'notes.md'), 'none', `Fixes:\nother:\n  - scout wrote no ${join(env.runDir, 'notes.md')} during this dispatch`));
    assert.deepEqual(env.run.dispatches[0].outcome, 'unusable');
    env.write('notes.md');
    const past = new Date(Date.parse(env.run.dispatches[1].openedAt) - 60_000);
    utimesSync(join(env.runDir, 'notes.md'), past, past);
    assert.equal((await env.result()).id, 3);
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom], ['blocked', 'discovery']);
    assert.equal(stop.reason, `discovery opened 3 times since the last human move, and the loop allows 3; the latest discovery dispatch ended unusable with ${join(env.runDir, 'notes.md')}, and these lines to fix:\nother:\n  - scout wrote no ${join(env.runDir, 'notes.md')} during this dispatch`);
    assert.equal(env.L.show(env.run).opens, 3);
});

test('result: the guard reads the status; a status outside the outcomes or none is unusable, and guard errors refuse', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md', 'needs-decisions');
    assert.match((await env.result()).message, /Fixes:\nscout returned needs-decisions, which is not an outcome of discovery:\n {2}- ok, blocked$/);
    spy({ guard: () => ({}) });
    env.write('notes.md');
    assert.match((await env.result()).message, /Fixes:\n.*notes\.md:\n {2}- the guard returned neither a status nor errors$/);
    assert.deepEqual(env.run.dispatches.map((d) => d.outcome), ['unusable', 'unusable', undefined]);
    const [, path, ctx] = calls.find(([h]) => h === 'guard')!;
    assert.deepEqual([path, ctx.event, ctx.dispatch.id, ctx.dispatch.attempt, ctx.runDir], [join(env.runDir, 'notes.md'), 'result', 2, 2, env.runDir]);
});

test('result: guard errors open the step again with Fixes, the grouped lines, a new attempt, and a new per-attempt document; the fourth open parks', async () => {
    const env = await building();
    spy({ guard: (path: string) => ({ errors: [`${path.split('/').at(-1)} § Checks: line 3 declares no value`, `${path.split('/').at(-1)} § Checks: cites no path`, 'plan.md § Steps: no step'] }) });
    env.write('build.1.report.md');
    const second = await env.result();
    assert.equal(second.message, message(env.runPath, 'build', join(env.runDir, 'build.2.report.md'), 'none', 'Fixes:\nbuild.1.report.md § Checks:\n  - line 3 declares no value\n  - cites no path\nplan.md § Steps:\n  - no step'));
    assert.deepEqual([env.run.dispatches.at(-2)!.outcome, env.run.dispatches.at(-1)!.attempt], ['refused', 2]);
    env.write('build.2.report.md');
    assert.equal((await env.result()).id, 5);
    env.write('build.3.report.md');
    const stop = await env.result();
    assert.equal(stop.stop, 'blocked');
    assert.match(stop.reason, /^build opened 3 times since the last human move, and the loop allows 3; the latest build dispatch ended refused with .*build\.3\.report\.md, and these lines to fix:\nbuild\.3\.report\.md § Checks:\n {2}- line 3/);
});

test('result: new question files enter the ledger after any step in numeric order, ask with no pending question is a refusal, and pending questions stop the run before the next step', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md');
    await env.result();
    env.write('plan.md', 'needs-decisions');
    const refusal = await env.result();
    assert.match(refusal.message, /^Step: draft\n(.|\n)*\nFixes:\nother:\n {2}- planner returned needs-decisions, and no question file is pending$/);
    env.write('Q-10.md', 'pending');
    env.write('Q-2.md', 'pending');
    env.write('plan.md', 'needs-decisions');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.status, stop.questions], ['questions', 'revision', [{ id: 'Q-2', file: join(env.runDir, 'Q-2.md') }, { id: 'Q-10', file: join(env.runDir, 'Q-10.md') }]]);
    assert.deepEqual(env.run.dispatches.map((d) => d.outcome), ['ok', 'needs-decisions', 'needs-decisions']);
    await env.L.answerQuestions(env.runPath, env.run, [{ id: 'Q-2', option: 'A', answer: 'a' }, { id: 'Q-10', option: 'B', answer: 'b' }]);
    assert.equal((await env.next()).message.split('\n')[0], 'Step: revision');

    const built = await building();
    built.write('Q-1.md', 'pending');
    built.write('build.1.report.md');
    const asked = await built.result();
    assert.deepEqual([asked.stop, asked.status, asked.questions.map((q: any) => q.id)], ['questions', 'verify-build', ['Q-1']]);
});

test('result: a refused onEnter of the target opens the step whose outcome led there again', async () => {
    const env = await building();
    spy({ onEnter: () => ['checks.1.md § tests: 1 failure'] });
    env.write('build.1.report.md');
    const again = await env.result();
    assert.deepEqual([again.agent, env.run.status, env.run.dispatches.at(-1)!.attempt, env.run.dispatches.at(-2)!.outcome], ['builder', 'build', 2, 'ok']);
    const [, ctx] = calls.find(([h]) => h === 'onEnter')!;
    assert.deepEqual([ctx.from, ctx.to, ctx.human, ctx.dispatch.id, ctx.dispatch.document], ['build', 'verify-build', false, 3, join(env.runDir, 'build.1.report.md')]);
    spy();
    env.write('build.2.report.md');
    assert.deepEqual([(await env.result()).agent, env.run.status], ['verifier', 'verify-build']);
});

test('park parks with the agent, the status, and the document', async () => {
    const env = await building();
    spy();
    env.write('build.1.report.md', 'plan-invalidated');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom, stop.reason], ['blocked', 'build', `builder returned plan-invalidated; the reason is in ${join(env.runDir, 'build.1.report.md')}.`]);
    assert.equal(calls.filter(([h]) => h === 'guard').length, 1);
});

test('a refused gate entry opens the step whose outcome led there again, with the errors as Fixes', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md');
    await env.result();
    spy({ planGuard: (path: string, ctx: any) => (ctx.event === 'enter' ? { errors: ['plan.md § Steps: step 2 names no file'] } : { status: 'ok' }) });
    env.write('plan.md');
    env.write('diff.md');
    const again = await env.result();
    assert.deepEqual([again.agent, env.run.dispatches.at(-1)!.name, env.run.status], ['planner', 'draft', 'draft']);
    assert.match(again.message, /Fixes:\nplan\.md § Steps:\n {2}- step 2 names no file$/);
});

test('diff.md is an artifact code writes: the plan guard writes it, the gate stop lists it, the approval freezes what the human saw, and a later gate stop names what changed since that decision', async () => {
    const env = await atGate();
    const diff = join(env.runDir, 'diff.md');
    const stop = await env.next();
    assert.deepEqual([stop.gate, stop.label, stop.freezes, stop.last, stop.changed], ['gate', 'Gate', ['notes.md', 'plan.md', 'diff.md'].map((f) => join(env.runDir, f)), undefined, undefined]);
    const seen = readFileSync(diff, 'utf8');
    await env.L.reject(env.runPath, env.run, 'gate', 'group C2 is wrong');
    await env.next();
    spy({ planGuard: (path: string, { event, runDir }: any) => (event === 'result' && writeFileSync(join(runDir, 'diff.md'), '# Diff\n\n2 change groups\n'), { status: 'ok' }) });
    env.write('plan.md', 'ok', 'group C2 split\n');
    const again = await env.result();
    assert.deepEqual([again.stop, again.last.decision, again.changed], ['gate', 'rejected', [join(env.runDir, 'plan.md'), diff]]);
    assert.notEqual(readFileSync(diff, 'utf8'), seen);
    await env.L.approve(env.runPath, env.run, 'gate', 'ship it');
    assert.deepEqual(calls.filter(([h]) => h === 'planGuard').map(([, , ctx]) => ctx.event), ['result', 'enter', 'approve']);
    assert.equal(env.run.freezes['diff.md'].sha256, fileSha256(diff));
});
