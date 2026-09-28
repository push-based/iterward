/**
 * node --test engine/dispatch.spec.mts
 *
 * Proves `next` and `result` on the fixture loop with spy hooks: the message template, document
 * freshness, the result hook and the outcomes, guard refusals and their Fixes, the question scan and `ask`,
 * validator refusals on a `transition` action, `park`, the route's gate refusal, and a gate summary as a frozen
 * artifact.
 */

import assert from 'node:assert/strict';
import { readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

import { atGate, building, calls, spy, started, tick } from './dispatch/spec/spy-loop.mts';
import { fileSha256 } from './util.mts';

beforeEach(() => spy());

test('a dispatch message fills the run path, the inputs, none for an absent optional input, the attempt, the document, the note, and route values', async () => {
    const env = await started();
    const first = await env.next();
    assert.deepEqual(first, { do: 'dispatch', id: 1, agent: 'scout', message: `Discovery mode. Subject: the progress bar. Design: none. Run: ${env.runPath}.` });
    assert.deepEqual(await env.next(), first, 'an open dispatch comes back unchanged');
    assert.deepEqual(env.run.dispatches[0].document, join(env.runDir, 'notes.md'));

    spy({ route: () => ({ dispatch: 'judge', with: { dispute: 'D-7' } }) });
    env.write('notes.md');
    const judge = await env.result();
    assert.equal(judge.message, `Judge dispute D-7. Run: ${env.runPath}. Verdict: ${join(env.runDir, 'verdict.1.md')}.`);
    assert.deepEqual(env.run.dispatches[1].with, { dispute: 'D-7' });

    spy({ route: () => ({ dispatch: 'judge' }) });
    env.write('verdict.1.md', 'upheld');
    await assert.rejects(env.result(), /the judge message names \{dispute\}, and nothing gives it a value/);
});

test('{note} is the latest human move after the dispatch last opened, and empty after that', async () => {
    const env = await building('ship it');
    assert.match(env.run.dispatches.at(-1)!.message, /Report: .*build\.1\.report\.md\. Note: 'ship it'\.$/);
    env.write('build.1.report.md', 'blocked');
    await env.result();
    await tick();
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'the host app builds again' });
    assert.match((await env.next()).message, /build\.2\.report\.md\. Note: 'the host app builds again'\.$/);
    env.write('build.2.report.md', 'ok');
    spy({ validator: () => ['checks.1.md § lint: 2 errors'] });
    assert.match((await env.result()).message, /build\.3\.report\.md\. Note: ''\.\nFixes:\nchecks\.1\.md § lint:\n {2}- 2 errors$/);
});

test('result: a missing or stale document is unusable, and the second unusable result in a row parks', async () => {
    const env = await started();
    await env.next();
    const again = await env.result();
    assert.equal(again.message, `Discovery mode. Subject: the progress bar. Design: none. Run: ${env.runPath}.\nFixes:\nother:\n  - scout wrote no ${join(env.runDir, 'notes.md')} during this dispatch`);
    assert.deepEqual([env.run.dispatches[0].outcome, env.run.streak.unusable], ['unusable', 1]);
    env.write('notes.md');
    const past = new Date(Date.parse(env.run.dispatches[1].openedAt) - 60_000);
    utimesSync(join(env.runDir, 'notes.md'), past, past);
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom], ['blocked', 'plan']);
    assert.match(stop.reason, /^scout returned no usable result 2 times in a row: scout wrote no .*notes\.md during this dispatch$/);
    assert.equal(env.run.streak.unusable, 0);
});

test('result: an error of the result hook and a status outside the outcomes are unusable', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md', 'needs-decisions');
    assert.match((await env.result()).message, /Fixes:\nscout returned needs-decisions, which is not an outcome of discovery:\n {2}- ok, blocked$/);
    spy({ readResult: () => ({ error: 'notes.md § frontmatter: no status' }) });
    env.write('notes.md');
    const stop = await env.result();
    assert.match(stop.reason, /2 times in a row: notes\.md § frontmatter: no status$/);
    const [, path, ctx] = calls.find(([h]) => h === 'readResult')!;
    assert.deepEqual([path, ctx.dispatch.id, ctx.dispatch.attempt, ctx.runDir], [join(env.runDir, 'notes.md'), 2, 2, env.runDir]);
});

test('result: a guard refusal re-dispatches with Fixes and the grouped lines, a new attempt, and a new per-attempt document; the third refusal in a row parks', async () => {
    const env = await started();
    spy({ route: () => ({ dispatch: 'judge', with: { dispute: 'D-1' } }), guard: (path: string) => [`${path.split('/').at(-1)} § Source: line 3 declares no value`, `${path.split('/').at(-1)} § Source: cites no path`, 'plan.md § Steps: no step'] });
    await env.next();
    env.write('verdict.1.md', 'upheld');
    const second = await env.result();
    assert.equal(second.message, `Judge dispute D-1. Run: ${env.runPath}. Verdict: ${join(env.runDir, 'verdict.2.md')}.\nFixes:\nverdict.1.md § Source:\n  - line 3 declares no value\n  - cites no path\nplan.md § Steps:\n  - no step`);
    const [, , ctx] = calls.find(([h]) => h === 'guard')!;
    assert.deepEqual([ctx.event, ctx.status, ctx.dispatch.name], ['result', 'upheld', 'judge']);
    assert.deepEqual([env.run.dispatches[0].outcome, env.run.dispatches[1].attempt, env.run.streak.refusals], ['upheld', 2, 1]);
    env.write('verdict.2.md', 'upheld');
    assert.equal((await env.result()).id, 3);
    env.write('verdict.3.md', 'upheld');
    const stop = await env.result();
    assert.equal(stop.stop, 'blocked');
    assert.match(stop.reason, /^judge was refused 3 times in a row; the latest refusal:\nverdict\.3\.md § Source:\n {2}- line 3/);
});

test('result: new question files enter the ledger at the initial state in numeric order, and ask with no pending question is a refusal', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md');
    await env.result();
    env.write('plan.md', 'needs-decisions');
    const refusal = await env.result();
    assert.match(refusal.message, /^Draft mode\. Run: .*\nFixes:\nother:\n {2}- planner returned needs-decisions and no question file is pending$/);
    env.write('Q-10.md', 'pending');
    env.write('Q-2.md', 'pending');
    env.write('plan.md', 'needs-decisions');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.questions], ['questions', [{ id: 'Q-2', file: join(env.runDir, 'Q-2.md') }, { id: 'Q-10', file: join(env.runDir, 'Q-10.md') }]]);
    assert.deepEqual(env.run.dispatches.map((d) => d.outcome), ['ok', 'needs-decisions', 'needs-decisions']);
});

test('result: a transition action runs the target\'s validator, and its refusal re-dispatches the same dispatch', async () => {
    const env = await building();
    spy({ validator: () => ['checks.1.md § tests: 1 failure'] });
    env.write('build.1.report.md');
    const again = await env.result();
    assert.deepEqual([again.agent, env.run.status, env.run.dispatches.at(-1)!.attempt], ['builder', 'build', 2]);
    const [, ctx] = calls.find(([h]) => h === 'validator')!;
    assert.deepEqual([ctx.from, ctx.to, ctx.human, ctx.dispatch.id, ctx.dispatch.document], ['build', 'verify-build', false, 3, join(env.runDir, 'build.1.report.md')]);
    spy();
    env.write('build.2.report.md');
    assert.deepEqual([(await env.result()).agent, env.run.status], ['verifier', 'verify-build']);
});

test('park parks with the agent, the status, and the document, and runs no guard', async () => {
    const env = await building();
    spy({ guard: () => ['never'] });
    env.write('build.1.report.md', 'plan-invalidated');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom, stop.reason], ['blocked', 'build', `builder returned plan-invalidated; the reason is in ${join(env.runDir, 'build.1.report.md')}.`]);
    assert.equal(calls.filter(([h]) => h === 'guard').length, 0);
});

test('the route\'s gate refusal re-dispatches its onRefusal with the errors, and a route name the loop lacks refuses', async () => {
    const env = await started();
    await env.next();
    env.write('notes.md');
    await env.result();
    spy({ guard: (path: string, ctx: any) => (path.endsWith('plan.md') && ctx.event === 'enter' ? ['plan.md § Steps: step 2 names no file'] : []) });
    env.write('plan.md');
    env.write('diff.md');
    const revision = await env.result();
    assert.deepEqual([revision.agent, env.run.dispatches.at(-1)!.name, env.run.status], ['planner', 'revision', 'plan']);
    assert.match(revision.message, /Fixes:\nplan\.md § Steps:\n {2}- step 2 names no file$/);
    spy({ route: () => ({ dispatch: 'build' }) });
    env.write('plan.md');
    await assert.rejects(env.result(), /the route's dispatch build is not one of discovery, draft, revision, judge/);
});

test('a gate summary is an artifact the gate freezes: its guard writes it on entry, the gate stop lists it, and the approval freezes what the human saw', async () => {
    // atGate reaches the gate only because the summary's guard writes summary.md before the engine checks every frozen file.
    const env = await atGate();
    const summary = join(env.runDir, 'summary.md');
    const stop = await env.next();
    assert.deepEqual([stop.gate, stop.label, stop.freezes], ['gate', 'Gate', ['notes.md', 'plan.md', 'diff.md', 'summary.md'].map((f) => join(env.runDir, f))]);
    const seen = readFileSync(summary, 'utf8');
    assert.equal(seen, '# Summary\n\n3 change groups\n');
    await env.L.approve(env.runPath, env.run, 'gate', 'ship it');
    assert.deepEqual(calls.filter(([h]) => h === 'summaryGuard').map(([, , ctx]) => ctx.event), ['enter', 'approve']);
    assert.deepEqual([readFileSync(summary, 'utf8'), env.run.freezes['summary.md'].sha256], [seen, fileSha256(summary)]);
});
