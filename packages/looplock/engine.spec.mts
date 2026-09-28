/**
 * node --test engine.spec.mts
 *
 * Proves the rules that cut across the engine's modules, on the fixture loop with spy hooks: a frozen file
 * edited after approval, the `opens` limit on a cycle between two steps and its reset, every stop kind with its
 * moves, warnings, `since`, and `recorded` as data, `show`, and that the repository holds no consumer vocabulary.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { context } from './engine/context.mts';
import { stop } from './engine/dispatch/internal/stop.mts';
import { atGate, building, spy, started, tick } from './engine/dispatch/spec/spy-loop.mts';
import { FreezeError } from './engine.mts';

beforeEach(() => spy());

test('an edited frozen file parks the run at the next agent transition and refuses a human transition, but for one that drops the freeze', async () => {
    const env = await building();
    env.write('plan.md', 'ok', 'edited after approval\n');
    env.write('build.1.report.md');
    const stop = await env.result();
    assert.deepEqual([stop.stop, stop.blockedFrom, stop.reason], ['blocked', 'build', 'plan.md changed after Gate froze it']);
    await assert.rejects(env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'go on' }), FreezeError);
    await env.L.transition(env.runPath, env.run, 'revision', { via: 'human', note: 'replan on the edited plan' });
    assert.deepEqual([env.run.status, env.run.freezes, env.run.gates.gate.decision], ['revision', {}, undefined]);
});

test('opens: a build and verify cycle parks at the fourth build open since the approval, and a human move into build resets the count', async () => {
    const env = await building();
    for (const n of [1, 2, 3]) {
        env.write(`build.${n}.report.md`);
        await env.result();
        env.write(`verify-build.${n}.report.md`, 'fail');
        const after = await env.result();
        if (n < 3) assert.equal(after.agent, 'builder');
        else assert.deepEqual([after.stop, after.reason], ['blocked', `build opened 3 times since the last human move, and the loop allows 3; the latest build dispatch ended ok with ${join(env.runDir, 'build.3.report.md')}.`]);
    }
    assert.equal(env.L.show(env.run).opens, 3);
    await tick();
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'try the fill once more' });
    assert.equal(env.L.show(env.run).opens, 0);
    assert.equal((await env.next()).agent, 'builder');
});

test('stops are data: each kind prints its fields, its moves, and the warnings; since lists the dispatches after the last human move', async () => {
    const warnings = ['no linter: the checks skip lint'];
    spy({ preflight: () => ({ errors: [], warnings }) });
    const env = await started();
    const inRun = (...files: string[]) => files.map((f) => join(env.runDir, f));
    const frozen = inRun('notes.md', 'plan.md', 'diff.md');
    await env.next();
    env.write('notes.md');
    await env.result();
    env.write('Q-1.md', 'pending');
    env.write('Q-2.md', 'pending');
    env.write('plan.md', 'needs-decisions');
    const questions = await env.result();
    assert.deepEqual(Object.keys(questions), ['do', 'stop', 'status', 'questions', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual(questions.moves, [{ call: 'answer', id: 'Q-1', freezes: inRun('Q-1.md') }, { call: 'answer', id: 'Q-2', freezes: inRun('Q-2.md') }]);
    assert.deepEqual([questions.status, questions.warnings, questions.recorded], ['revision', warnings, []]);
    assert.deepEqual(questions.since.map((d: any) => [d.id, d.name, d.agent, d.attempt, d.outcome]), [[1, 'discovery', 'scout', 1, 'ok'], [2, 'draft', 'planner', 1, 'needs-decisions']]);

    await tick();
    await env.L.answerQuestions(env.runPath, env.run, [{ id: 'Q-1', option: 'A', answer: 'keep the purpose values' }]);
    const repeated = await env.next();
    assert.deepEqual([repeated.questions.map((q: any) => q.id), repeated.since], [['Q-2'], []]);
    assert.deepEqual(repeated.recorded, [{ call: 'answer', id: 'Q-1', chosen: 'A', answer: 'keep the purpose values', at: env.run.questions[0].resolvedAt }]);
    await env.L.answerQuestions(env.runPath, env.run, [{ id: 'Q-2', option: 'custom', answer: 'use the raw value' }]);
    await tick();

    assert.equal((await env.next()).agent, 'planner');
    env.write('plan.md');
    const gate = await env.result();
    assert.deepEqual(Object.keys(gate), ['do', 'stop', 'status', 'gate', 'label', 'freezes', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual(gate.moves, [
        { call: 'gate', gate: 'gate', decision: 'approved', to: 'build', freezes: frozen },
        { call: 'gate', gate: 'gate', decision: 'rejected', to: 'revision' },
    ]);
    await env.L.reject(env.runPath, env.run, 'gate', 'group C2 is wrong');
    assert.match((await env.next()).message, /\nNote: group C2 is wrong\n/);
    env.write('plan.md', 'ok', 'group C2 split\n');
    const again = await env.result();
    assert.deepEqual(Object.keys(again), ['do', 'stop', 'status', 'gate', 'label', 'freezes', 'last', 'changed', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual([again.last.decision, again.changed, again.since.map((d: any) => d.name)], ['rejected', inRun('plan.md'), ['revision']]);

    await env.L.approve(env.runPath, env.run, 'gate', 'ship it');
    await env.next();
    env.write('build.1.report.md', 'blocked');
    const blocked = await env.result();
    assert.deepEqual(Object.keys(blocked), ['do', 'stop', 'status', 'blockedFrom', 'reason', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual(blocked.moves, [
        { call: 'transition', to: 'build', resumes: true },
        { call: 'transition', to: 'revision', drops: { gate: 'gate', files: frozen } },
    ]);
    assert.deepEqual([blocked.warnings, blocked.since.map((d: any) => [d.name, d.outcome])], [warnings, [['build', 'blocked']]]);

    await tick();
    await env.L.transition(env.runPath, env.run, 'build', { via: 'human', note: 'the host app builds again' });
    await env.next();
    env.write('build.2.report.md');
    await env.result();
    env.write('verify-build.1.report.md', 'pass');
    const status = await env.result();
    assert.deepEqual(Object.keys(status), ['do', 'stop', 'status', 'moves', 'warnings', 'since', 'recorded']);
    assert.deepEqual([status.stop, status.status], ['status', 'release']);
    assert.deepEqual(status.moves, [
        { call: 'transition', to: 'revision', drops: { gate: 'gate', files: frozen } },
        { call: 'transition', to: 'build' },
    ]);
});

test('recorded lists the human moves since the latest closed dispatch: a gate approval without a note, then a human transition', async () => {
    const env = await atGate();
    await env.L.approve(env.runPath, env.run, 'gate');
    const approvedAt = env.run.gates.gate.at;
    await tick();
    await env.L.transition(env.runPath, env.run, 'revision', { via: 'human', note: 'the purpose is wrong' });
    const out = stop(context(env.L.cfg), env.runPath, env.run, 'status');
    assert.deepEqual(out.recorded, [
        { call: 'gate', gate: 'gate', decision: 'approved', at: approvedAt },
        { call: 'transition', from: 'build', to: 'revision', note: 'the purpose is wrong', at: env.run.history.at(-1)!.at },
    ]);
    assert.equal(env.run.history.filter((h) => h.human).length, 2, 'the approval and the transition');
});

test('every stop carries the preflight warnings, also after the gate approval', async () => {
    const warnings = ['no linter: the checks skip lint'];
    spy({ preflight: () => ({ errors: [], warnings }) });
    const env = await atGate();
    assert.deepEqual((await env.next()).warnings, warnings);
    await env.L.approve(env.runPath, env.run, 'gate', 'ship it');
    await env.next();
    env.write('build.1.report.md', 'blocked');
    assert.deepEqual((await env.result()).warnings, warnings);
});

test('show prints only the run\'s state', async () => {
    const env = await atGate();
    await env.L.reject(env.runPath, env.run, 'gate', 'group C2 is wrong');
    await env.next();
    const shown = env.L.show(env.run);
    assert.deepEqual({ ...shown, gates: { gate: { ...shown.gates.gate, at: 0 } } }, {
        status: 'revision', blockedFrom: null, inputs: { subject: 'the progress bar' },
        gates: { gate: { decision: 'rejected', note: 'group C2 is wrong', at: 0 } },
        questions: [], freezes: {}, warnings: [], opens: 1, dispatches: 3,
        open: { id: 3, agent: 'planner', document: join(env.runDir, 'plan.md') },
    });
});

test('the repository holds no consumer vocabulary', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    // This file lists the words, so it skips itself. Installed dependencies, build output, and git data aren't the repository's own files.
    const skip = ['node_modules', 'dist', '.git'];
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.m?ts$|\.md$|\.json$/.test(f) && f !== 'engine.spec.mts' && !f.split('/').some((d) => skip.includes(d)));
    const words = /\bfds\b|themepark|brand|\btokens?\b|scss|sass|kiro|\b[lL][123]\b|\brfc\b|supersede|\bevid\b|bwin/i;
    const hits = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => (words.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null)).filter(Boolean));
    assert.deepEqual(hits, []);
});
