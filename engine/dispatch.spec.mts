/**
 * node --test engine/dispatch.spec.mts
 *
 * Proves `next` and `result` on the FDS-shaped fixture loop with spy hooks: the message template, document
 * freshness, the result hook and the outcomes, guard refusals and their Fixes, the question scan and `ask`,
 * validator refusals on a `transition` action, `park`, and the route's gate refusal.
 */

import assert from 'node:assert/strict';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';

import { atGate, building, calls, spy, started, tick } from './dispatch/spec/spy-loop.mts';

beforeEach(() => spy());

test('a dispatch message fills the run path, the inputs, none for an absent optional input, the attempt, the document, the note, and route values', async () => {
    const env = await started();
    const first = await env.next();
    assert.deepEqual(first, { do: 'dispatch', id: 1, agent: 'l2-discovery', message: `Discovery mode. Component: packages/promo/x/progress-bar. Design: none. Run: ${env.runPath}.` });
    assert.deepEqual(await env.next(), first, 'an open dispatch comes back unchanged');
    assert.deepEqual(env.run.dispatches[0].document, join(env.runDir, 'EVID-discovery.md'));

    spy({ route: () => ({ dispatch: 'judge', with: { dispute: 'R-3f2a9c1b/bwin' } }) });
    env.write('EVID-discovery.md');
    const judge = await env.result();
    assert.equal(judge.message, `Judge dispute R-3f2a9c1b/bwin. Run: ${env.runPath}. Verdict: ${join(env.runDir, 'verdict.1.md')}.`);
    assert.deepEqual(env.run.dispatches[1].with, { dispute: 'R-3f2a9c1b/bwin' });

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
    assert.equal(again.message, `Discovery mode. Component: packages/promo/x/progress-bar. Design: none. Run: ${env.runPath}.\nFixes:\nother:\n  - l2-discovery wrote no ${join(env.runDir, 'EVID-discovery.md')} during this dispatch`);
    assert.deepEqual([env.run.dispatches[0].outcome, env.run.streak.unusable], ['unusable', 1]);
    env.write('EVID-discovery.md');
    const past = new Date(Date.parse(env.run.dispatches[1].openedAt) - 60_000);
    utimesSync(join(env.runDir, 'EVID-discovery.md'), past, past);
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom], ['blocked', 'plan']);
    assert.match(stop.reason, /^l2-discovery returned no usable result 2 times in a row: l2-discovery wrote no .*EVID-discovery\.md during this dispatch$/);
    assert.equal(env.run.streak.unusable, 0);
});

test('result: an error of the result hook and a status outside the outcomes are unusable', async () => {
    const env = await started();
    await env.next();
    env.write('EVID-discovery.md', 'needs-decisions');
    assert.match((await env.result()).message, /Fixes:\nl2-discovery returned needs-decisions, which is not an outcome of discovery:\n {2}- ok, blocked$/);
    spy({ readResult: () => ({ error: 'EVID-discovery.md § frontmatter: no status' }) });
    env.write('EVID-discovery.md');
    const stop = await env.result();
    assert.match(stop.reason, /2 times in a row: EVID-discovery\.md § frontmatter: no status$/);
    const [, path, ctx] = calls.find(([h]) => h === 'readResult')!;
    assert.deepEqual([path, ctx.dispatch.id, ctx.dispatch.attempt, ctx.runDir], [join(env.runDir, 'EVID-discovery.md'), 2, 2, env.runDir]);
});

test('result: a guard refusal re-dispatches with Fixes and the grouped lines, a new attempt, and a new per-attempt document; the third refusal in a row parks', async () => {
    const env = await started();
    spy({ route: () => ({ dispatch: 'judge', with: { dispute: 'R-1/bwin' } }), guard: (path: string) => [`${path.split('/').at(-1)} § Source: line 3 declares no value`, `${path.split('/').at(-1)} § Source: cites no path`, 'plan.md § Tokens: no key'] });
    await env.next();
    env.write('verdict.1.md', 'upheld');
    const second = await env.result();
    assert.equal(second.message, `Judge dispute R-1/bwin. Run: ${env.runPath}. Verdict: ${join(env.runDir, 'verdict.2.md')}.\nFixes:\nverdict.1.md § Source:\n  - line 3 declares no value\n  - cites no path\nplan.md § Tokens:\n  - no key`);
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
    env.write('EVID-discovery.md');
    await env.result();
    env.write('plan.md', 'needs-decisions');
    const refusal = await env.result();
    assert.match(refusal.message, /^Draft mode\. Run: .*\nFixes:\nother:\n {2}- l2-planner returned needs-decisions and no question file is pending$/);
    env.write('RFC-10.md', 'pending');
    env.write('RFC-2.md', 'pending');
    env.write('plan.md', 'needs-decisions');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.questions], ['questions', [{ id: 'RFC-2', file: join(env.runDir, 'RFC-2.md') }, { id: 'RFC-10', file: join(env.runDir, 'RFC-10.md') }]]);
    assert.deepEqual(env.run.dispatches.map((d) => d.outcome), ['ok', 'needs-decisions', 'needs-decisions']);
});

test('result: a transition action runs the target\'s validator, and its refusal re-dispatches the same dispatch', async () => {
    const env = await building();
    spy({ validator: () => ['checks.1.md § tokens row: bwin differs'] });
    env.write('build.1.report.md');
    const again = await env.result();
    assert.deepEqual([again.agent, env.run.status, env.run.dispatches.at(-1)!.attempt], ['l2-builder', 'build', 2]);
    const [, ctx] = calls.find(([h]) => h === 'validator')!;
    assert.deepEqual([ctx.from, ctx.to, ctx.human, ctx.dispatch.id, ctx.dispatch.document], ['build', 'verify-build', false, 3, join(env.runDir, 'build.1.report.md')]);
    spy();
    env.write('build.2.report.md');
    assert.deepEqual([(await env.result()).agent, env.run.status], ['l2-verifier', 'verify-build']);
});

test('park parks with the agent, the status, and the document, and runs no guard', async () => {
    const env = await building();
    spy({ guard: () => ['never'] });
    env.write('build.1.report.md', 'plan-invalidated');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom, stop.reason], ['blocked', 'build', `l2-builder returned plan-invalidated; the reason is in ${join(env.runDir, 'build.1.report.md')}.`]);
    assert.equal(calls.filter(([h]) => h === 'guard').length, 0);
});

test('the route\'s gate refusal re-dispatches its onRefusal with the errors, and a route name the loop lacks refuses', async () => {
    const env = await started();
    await env.next();
    env.write('EVID-discovery.md');
    await env.result();
    spy({ guard: (path: string, ctx: any) => (path.endsWith('plan.md') && ctx.event === 'enter' ? ['plan.md § Tokens: key fill cites no row'] : []) });
    env.write('plan.md');
    env.write('diff.md');
    const revision = await env.result();
    assert.deepEqual([revision.agent, env.run.dispatches.at(-1)!.name, env.run.status], ['l2-planner', 'revision', 'plan']);
    assert.match(revision.message, /Fixes:\nplan\.md § Tokens:\n {2}- key fill cites no row$/);
    spy({ route: () => ({ dispatch: 'build' }) });
    env.write('plan.md');
    await assert.rejects(env.result(), /the route's dispatch build is not one of discovery, draft, revision, judge/);
});

test('entering the gate by the route stops at the gate with its summary', async () => {
    const env = await atGate();
    const stop = await env.next();
    assert.deepEqual([stop.gate, stop.label, stop.summary], ['gate1', 'Gate 1', ['gate1: 3 change groups']]);
    assert.deepEqual(stop.freezes, ['EVID-discovery.md', 'plan.md', 'diff.md'].map((f) => join(env.runDir, f)));
});
