/**
 * node --test engine.spec.mts
 *
 * Proves the rules that cut across the engine's modules, on the FDS-shaped fixture loop with spy hooks: a
 * frozen file edited after approval, the `maxFailed` limit and its reset, every stop kind with its moves,
 * warnings, `since`, and `recorded`, `show`, and that the engine holds no consumer vocabulary.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { atGate, building, spy, started, tick } from './engine/dispatch/spec/spy-loop.mts';
import { FreezeError } from './engine.mts';

beforeEach(() => spy());

const FROZEN = 'EVID-discovery.md, plan.md, and diff.md';

test('an edited frozen file parks the run at the next agent transition and refuses a human transition', async () => {
    const env = await building();
    env.write('plan.md', 'ok', 'edited after approval\n');
    env.write('build.1.report.md');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom, stop.reason], ['blocked', 'build', 'plan.md changed after Gate 1 froze it']);
    await assert.rejects(env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'go on' }), FreezeError);
    await env.L.transition(env.runPath, env.run, 'plan', { via: 'human', note: 'replan on the edited plan' });
    assert.deepEqual([env.run.status, env.run.freezes, env.run.gates.gate1.decision], ['plan', {}, undefined]);
});

test('maxFailed: 3 failed verdicts since the approval park the run with the engine\'s note, and a human transition into build resets the count', async () => {
    const env = await building();
    for (const n of [1, 2, 3]) {
        env.write(`build.${n}.report.md`);
        await env.result();
        env.write(`verify-build.${n}.report.md`, 'fail');
        const after = await env.result();
        if (n < 3) assert.equal(after.agent, 'l2-builder');
        else assert.deepEqual([after.stop, after.reason], ['blocked', `3 failed verify-build verdicts since the last human move into build; the latest report is ${join(env.runDir, 'verify-build.3.report.md')}.`]);
    }
    assert.equal(env.L.show(env.run).failed, 3);
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'try the fill once more' });
    assert.equal(env.L.show(env.run).failed, 0);
    assert.equal((await env.next()).agent, 'l2-builder');
});

test('stops: each kind prints its fields and its moves; warnings show while Gate 1 is not approved; a repeated stop repeats since and recorded', async () => {
    spy({ preflight: () => ({ errors: [], warnings: ['no Sass compiler: the scope falls back to a repository scan'] }) });
    const env = await started();
    const warnings = ['no Sass compiler: the scope falls back to a repository scan'];
    await env.next();
    env.write('EVID-discovery.md');
    await env.result();
    env.write('RFC-1.md', 'pending');
    env.write('RFC-2.md', 'pending');
    env.write('plan.md', 'needs-decisions');
    const questions = await env.result();
    assert.deepEqual(Object.keys(questions), ['do', 'stop', 'status', 'questions', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual(questions.moves, [
        "`answer` RFC-1 with an option key or `custom`, and the human's words: resolves RFC-1 and freezes RFC-1.md.",
        "`answer` RFC-2 with an option key or `custom`, and the human's words: resolves RFC-2 and freezes RFC-2.md.",
    ]);
    assert.deepEqual([questions.warnings, questions.recorded], [warnings, []]);
    assert.deepEqual(questions.since.map((d: any) => [d.id, d.name, d.agent, d.attempt, d.outcome]), [[1, 'discovery', 'l2-discovery', 1, 'ok'], [2, 'draft', 'l2-planner', 1, 'needs-decisions']]);

    await env.L.answerQuestion(env.runPath, env.run, { id: 'RFC-1', option: 'A', answer: 'keep the purpose values' });
    const repeated = await env.next();
    assert.deepEqual([repeated.questions.map((q: any) => q.id), repeated.since, repeated.recorded], [['RFC-2'], questions.since, ['answer RFC-1 A: "keep the purpose values"']]);
    await env.L.answerQuestion(env.runPath, env.run, { id: 'RFC-2', option: 'custom', answer: 'use the raw value' });
    await tick();

    assert.equal((await env.next()).agent, 'l2-planner');
    env.write('plan.md');
    env.write('diff.md');
    const gate = await env.result();
    assert.deepEqual(Object.keys(gate), ['do', 'stop', 'status', 'gate', 'label', 'freezes', 'summary', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual(gate.moves, [
        `\`gate\` gate1 approved, with an optional note: freezes ${FROZEN} and moves to build.`,
        "`gate` gate1 rejected, with the human's note: records the note and moves back to plan, and re-freezes the answered questions.",
    ]);
    await env.L.reject(env.runPath, env.run, 'gate1', 'group C2 is wrong');
    const again = await env.next();
    assert.deepEqual([again.stop, again.since, again.recorded], ['gate', gate.since, ['gate gate1 rejected: "group C2 is wrong"']]);

    await env.L.approve(env.runPath, env.run, 'gate1', 'ship it');
    await env.next();
    env.write('build.1.report.md', 'blocked');
    const blocked = await env.result();
    assert.deepEqual(Object.keys(blocked), ['do', 'stop', 'status', 'blockedFrom', 'reason', 'moves', 'since', 'recorded']);
    assert.deepEqual(blocked.moves, [
        "`transition` to build, with the human's note: resumes build, and the failed count resets.",
        `\`transition\` to plan, with the human's note: moves to plan and drops the Gate 1 freeze on ${FROZEN}, and re-freezes the answered questions.`,
    ]);
    assert.deepEqual(blocked.since.map((d: any) => [d.name, d.outcome]), [['build', 'blocked']]);

    await tick();
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'the host app builds again' });
    await env.next();
    env.write('build.2.report.md');
    await env.result();
    env.write('verify-build.1.report.md', 'pass');
    const status = await env.result();
    assert.deepEqual(Object.keys(status), ['do', 'stop', 'status', 'moves', 'since', 'recorded']);
    assert.deepEqual([status.stop, status.status], ['status', 'integrate']);
    assert.deepEqual(status.moves, [
        `\`transition\` to plan, with the human's note: moves to plan and drops the Gate 1 freeze on ${FROZEN}, and re-freezes the answered questions.`,
        "`transition` to build, with the human's note: retries build, and the failed count resets.",
    ]);
});

test('recorded words a human transition, and a gate approval without a note', async () => {
    const env = await atGate();
    await env.L.approve(env.runPath, env.run, 'gate1');
    await tick();
    // No dispatch closes between the approval and the transition back, so the next stop records both.
    await env.L.transition(env.runPath, env.run, 'plan', { via: 'human', note: 'the purpose is wrong' });
    spy({ route: () => ({ gate: 'gate1', onRefusal: 'revision' }) });
    const stop = await env.next();
    assert.deepEqual([stop.stop, stop.recorded], ['gate', ['gate gate1 approved', 'transition build → plan: "the purpose is wrong"']]);
    assert.equal(env.run.history.filter((h) => h.human).length, 2, 'the approval and the transition');
});

test('warnings show at every stop before Gate 1, also after a human transition back past it', async () => {
    const warnings = ['no Sass compiler: the scope falls back to a repository scan'];
    spy({ preflight: () => ({ errors: [], warnings }) });
    const env = await atGate();
    assert.deepEqual((await env.next()).warnings, warnings);
    await env.L.approve(env.runPath, env.run, 'gate1', 'ship it');
    await env.next();
    env.write('build.1.report.md', 'blocked');
    const blocked = await env.result();
    assert.deepEqual([blocked.stop, blocked.warnings], ['blocked', undefined]);
    await env.L.transition(env.runPath, env.run, 'plan', { via: 'human', note: 'replan' });
    const gate = await env.next();
    assert.deepEqual([gate.stop, gate.warnings], ['gate', warnings]);
});

test('show prints only the run\'s state', async () => {
    const env = await atGate();
    await env.L.reject(env.runPath, env.run, 'gate1', 'group C2 is wrong');
    spy({ route: () => ({ dispatch: 'revision' }) });
    await env.next();
    const shown = env.L.show(env.run);
    assert.deepEqual({ ...shown, gates: { gate1: { ...shown.gates.gate1, at: 0 } } }, {
        status: 'plan', blockedFrom: null, inputs: { component: 'packages/promo/x/progress-bar' },
        gates: { gate1: { decision: 'rejected', note: 'group C2 is wrong', at: 0 } },
        questions: [], freezes: {}, warnings: [], failed: 0, dispatches: 3,
        open: { id: 3, agent: 'l2-planner', document: join(env.runDir, 'plan.md') },
    });
});

test('the engine holds no consumer vocabulary', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    // Specs and their fixtures under spec/ may name a consumer; the engine, the CLI, the server, and the docs may not.
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.m?ts$|\.md$|\.json$/.test(f) && !f.endsWith('.spec.mts') && !f.split('/').includes('spec'));
    const words = /\bfds\b|themepark|brand|\btokens?\b|scss|kiro|\b[lL][123]\b/;
    const hits = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => (words.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null)).filter(Boolean));
    assert.deepEqual(hits, []);
});
