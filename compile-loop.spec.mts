/**
 * node --test compile-loop.spec.mts
 *
 * Proves the loop loader and the stage compiler: the FDS-shaped fixture loop in `spec/loop/` compiles to the
 * states, human edges, default outcomes, and failed limit the stage kinds and order give, with every inferred
 * pointer listed; the loader resolves hooks relative to the loop file and refuses a hook it can't use; each
 * fault refuses the configuration when it loads, naming the place; and the configuration hash covers every
 * hook module and the modules it imports.
 */

import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileLoop, inferredOf, printable } from './compile-loop.mts';
import type { LoopFile } from './config.mts';
import { loadLoop } from './load-config.mts';

const FIXTURE = fileURLToPath(new URL('./spec/loop/', import.meta.url));
/** A fresh parsed copy of the fixture loop file. */
const fds = (): any => JSON.parse(readFileSync(join(FIXTURE, 'fds.loop.json'), 'utf8'));
/** A copy of the fixture folder in a temporary folder, with its loop file changed by `edit`. */
function copy(edit: (loop: any) => void = () => {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'looplock-loop-'));
    cpSync(FIXTURE, dir, { recursive: true });
    const loop = fds();
    edit(loop);
    writeFileSync(join(dir, 'fds.loop.json'), JSON.stringify(loop));
    return join(dir, 'fds.loop.json');
}
const HOOK = (name: string) => ({ module: './hooks.mts', export: name });

test('the FDS-shaped loop compiles to its states, human edges, default outcomes, and failed limit', () => {
    const { config, inferred } = compileLoop(fds());
    assert.equal(config.initial, 'plan');
    assert.deepEqual(config.states, {
        plan: ['gate1', 'blocked'],
        gate1: ['build', 'plan', 'blocked'],
        build: ['verify-build', 'blocked'],
        'verify-build': ['integrate', 'build', 'blocked'],
        integrate: ['blocked'],
        blocked: ['plan', 'gate1', 'build', 'verify-build', 'integrate'],
    });
    const back = { to: 'plan', drops: 'gate1' };
    const retry = { to: 'build', retries: true, resets: true };
    assert.deepEqual(config.human, { plan: [], gate1: [], build: [back], 'verify-build': [back, retry], integrate: [back, retry] });
    assert.deepEqual(config.gates, { gate1: { label: 'Gate 1', next: 'build', back: 'plan', freezes: ['discovery', 'plan', 'diff'] } });
    assert.equal(config.freezeGate, 'gate1');
    assert.deepEqual(config.dispatches.build.outcomes, { ok: { transition: 'verify-build' }, blocked: { park: true }, 'plan-invalidated': { park: true } });
    assert.deepEqual(config.dispatches['verify-build'].outcomes, { pass: { transition: 'integrate' }, fail: { transition: 'build' }, blocked: { park: true }, 'plan-invalidated': { park: true } });
    assert.deepEqual(config.dispatches.judge, { agent: 'l2-judge', artifact: 'verdict', message: 'Judge dispute {dispute}. Run: {runPath}. Verdict: {document}.', outcomes: { upheld: { route: true }, rejected: { route: true }, unsure: { route: true } } });
    assert.deepEqual(config.byStatus, { build: 'build', 'verify-build': 'verify-build' });
    assert.deepEqual(config.stops, ['integrate']);
    assert.deepEqual(config.limits, { redispatch: 2, unusable: 1, dispatchMinutes: 30, failed: { stage: 'verify-build', at: 'build', max: 3 } });
    assert.deepEqual(['RFC-7.md', 'RFC-x.md', 'RFC-7.md.bak'].map((f) => config.questions!.exec(f)?.[1]), ['7', undefined, undefined]);
    assert.deepEqual(inferred, [
        '/states/plan/0',
        '/gates/gate1/next',
        '/gates/gate1/back',
        '/dispatches/build/outcomes/ok',
        '/dispatches/build/outcomes/blocked',
        '/dispatches/verify-build/outcomes/pass',
        '/dispatches/verify-build/outcomes/fail',
        '/dispatches/verify-build/outcomes/blocked',
        '/limits/redispatch',
        '/limits/unusable',
        '/limits/failed',
    ]);
    assert.deepEqual(inferredOf(config), inferred);
});

test('an explicit target or outcome beats the default, null removes a default, and a clashing human edge merges', () => {
    const loop = fds();
    loop.stages[1] = { ...loop.stages[1], back: 'build' };
    loop.stages[3] = { ...loop.stages[3], fail: 'plan', dispatch: { ...loop.stages[3].dispatch, outcomes: { pass: { transition: 'build' }, blocked: null } } };
    loop.limits = { redispatch: 0, unusable: 3 };
    const { config, inferred } = compileLoop(loop);
    assert.deepEqual(config.gates.gate1.back, 'build');
    assert.deepEqual(config.dispatches['verify-build'].outcomes, { pass: { transition: 'build' }, fail: { transition: 'plan' } });
    assert.deepEqual(config.states['verify-build'], ['build', 'plan', 'blocked']);
    assert.deepEqual(config.limits, { redispatch: 0, unusable: 3, failed: { stage: 'verify-build', at: 'plan', max: 3 } });
    // The back edge and the retry edge both lead to one stage, so the human sees one move with both effects.
    assert.deepEqual(config.human['verify-build'], [{ to: 'build', drops: 'gate1' }, { to: 'plan', retries: true, resets: true }]);
    assert.deepEqual(inferred.filter((p) => /back|verify-build\/outcomes\/pass|limits\/(redispatch|unusable)/.test(p)), []);
});

test('printable shows each hook as its HookRef and the question pattern as its source', () => {
    const out = printable(compileLoop(fds()).config);
    assert.deepEqual(out.route, HOOK('route'));
    assert.deepEqual(out.result, HOOK('readResult'));
    assert.deepEqual(out.artifacts.plan, { file: 'plan.md', guard: HOOK('guard') });
    assert.deepEqual(out.artifacts.diff, { file: 'diff.md' });
    assert.deepEqual(out.gates.gate1.summary, HOOK('gateSummary'));
    assert.deepEqual(out.validators, { 'verify-build': HOOK('validator'), integrate: HOOK('validator') });
    assert.equal(out.questions, String(/^RFC-(\d+)\.md$/));
    assert.equal(out.hooks, undefined);
});

test('the loader resolves each hook relative to the loop file, and refuses a missing module, a missing export, and a non-function export', async () => {
    const path = copy();
    const config = await loadLoop(path);
    const mod = await import(pathToFileURL(join(path, '..', 'hooks.mts')).href);
    assert.equal(config.result, mod.readResult);
    assert.equal(config.route, mod.route);
    assert.equal(config.artifacts.plan.guard, mod.guard);
    assert.equal(config.gates.gate1.summary, mod.gateSummary);
    assert.equal(config.validators.integrate, mod.validator);
    assert.deepEqual(printable(config).route, HOOK('route'));
    assert.match(config.sha256, /^[0-9a-f]{64}$/);

    await assert.rejects(loadLoop(copy((l) => { l.artifacts.plan.guard.module = './nope.mts'; })), /^Error: loop fds-l2, artifacts\.plan\.guard: \.\/nope\.mts can't be imported: /);
    await assert.rejects(loadLoop(copy((l) => { l.artifacts.plan.guard.export = 'planGuard'; })), /^Error: loop fds-l2, artifacts\.plan\.guard: \.\/hooks\.mts has no export planGuard$/);
    await assert.rejects(loadLoop(copy((l) => { l.stages[1].summary.export = 'STATUSES'; })), /^Error: loop fds-l2, gates\.gate1\.summary: \.\/hooks\.mts's export STATUSES is not a function$/);
    await assert.rejects(loadLoop(join(path, '..', 'missing.loop.json')), /^Error: loop file .*missing\.loop\.json: ENOENT/);
});

test('FAIL FAST: each fault refuses the configuration when it loads, naming the place', () => {
    type Edit = (l: any) => void;
    const at = (i: number, patch: object): Edit => (l) => { l.stages[i] = { ...l.stages[i], ...patch }; };
    const dispatch = (i: number, patch: object): Edit => (l) => { l.stages[i].dispatch = { ...l.stages[i].dispatch, ...patch }; };
    const artifact = (file: string): Edit => (l) => { l.artifacts.plan.file = file; };
    const refused: [Edit, RegExp][] = [
        // Unknown fields, at every level.
        [(l) => { l.routeTransitions = {}; }, /^Error: loop fds-l2, routeTransitions: not a field of a loop file$/],
        [(l) => { l.inputs.extra = []; }, /^Error: loop fds-l2, inputs, extra: not a field of inputs$/],
        [(l) => { l.limits.failed = {}; }, /^Error: loop fds-l2, limits, failed: not a field of limits$/],
        [(l) => { l.artifacts.plan.store = 'over'; }, /^Error: loop fds-l2, artifact plan, store: not a field of an artifact$/],
        [(l) => { l.result.path = 'x'; }, /^Error: loop fds-l2, result, path: not a field of a hook$/],
        [at(1, { scopes: {} }), /^Error: loop fds-l2, stage gate1, scopes: not a field of a gate stage$/],
        [at(3, { revoke: true }), /^Error: loop fds-l2, stage verify-build, revoke: not a field of a verify stage$/],
        [dispatch(2, { human: true }), /^Error: loop fds-l2, stage build, dispatch, human: not a field of a dispatch$/],
        [(l) => { l.stages[0].dispatches.draft.outcomes.ok = { store: 'plan' }; }, /stage plan, dispatches\.draft\.outcomes\.ok: an outcome takes one of/],
        [(l) => { l.stages[0].dispatches.draft.outcomes.ok = { route: true, park: true }; }, /stage plan, dispatches\.draft\.outcomes\.ok: an outcome takes one of/],
        [(l) => { l.stages[0].dispatches.draft.outcomes.ok = { park: 'yes' }; }, /stage plan, dispatches\.draft\.outcomes\.ok: park takes true/],
        // Freezes.
        [at(1, { freezes: ['plan', 'verdict'] }), /^Error: loop fds-l2, stage gate1, freezes: verdict is written per attempt; a freeze holds one file$/],
        [at(1, { freezes: ['nope'] }), /^Error: loop fds-l2, stage gate1, freezes: nope is not an artifact$/],
        [(l) => { l.stages.splice(4, 0, { gate: 'gate2', label: 'Gate 2', freezes: ['plan'] }); }, /^Error: loop fds-l2, stage gate2, freezes: gate gate1 freezes already; one gate freezes$/],
        // Actions.
        [dispatch(2, { outcomes: { 'needs-decisions': { ask: true } } }), /^Error: loop fds-l2, stage build, dispatch\.outcomes\.needs-decisions: ask runs only in a plan dispatch$/],
        [dispatch(3, { outcomes: { unsure: { route: true } } }), /^Error: loop fds-l2, stage verify-build, dispatch\.outcomes\.unsure: route runs only in a plan dispatch$/],
        [(l) => { delete l.questions; }, /^Error: loop fds-l2, stage plan, dispatches\.draft\.outcomes\.needs-decisions: ask needs the loop's questions pattern$/],
        [dispatch(2, { outcomes: { ok: { transition: 'nope' } } }), /^Error: loop fds-l2, stage build, dispatch\.outcomes\.ok: nope is not a stage of the loop$/],
        [dispatch(2, { outcomes: { ok: { transition: 'blocked' } } }), /^Error: loop fds-l2, stage build, dispatch\.outcomes\.ok: blocked is not a stage of the loop$/],
        [dispatch(2, { artifact: 'nope' }), /^Error: loop fds-l2, stage build, dispatch\.artifact: nope is not an artifact$/],
        [dispatch(2, { agent: '' }), /^Error: loop fds-l2, stage build, dispatch\.agent: must be a nonempty string$/],
        [(l) => { l.stages[0].dispatches.build = l.stages[0].dispatches.draft; }, /^Error: loop fds-l2, stage build, dispatch: a dispatch is named build already$/],
        // Placeholders: a work or verify message names only fixed placeholders and inputs; a plan message can name route values.
        [dispatch(2, { message: 'Run: {runPath}. Dispute: {dispute}.' }), /^Error: loop fds-l2, stage build, dispatch\.message: \{dispute\} is neither a placeholder the engine fills nor an input$/],
        [dispatch(3, { message: 'Subject: {subject}.' }), /^Error: loop fds-l2, stage verify-build, dispatch\.message: \{subject\} is neither/],
        // Stage order and kinds.
        [(l) => { l.stages.shift(); }, /^Error: loop fds-l2, stage gate1, gate: the first stage must be a plan stage$/],
        [(l) => { l.stages.splice(1, 0, { ...l.stages[0], plan: 'again' }); }, /^Error: loop fds-l2, stage again, plan: only the first stage is a plan stage$/],
        [(l) => { l.stages.splice(4, 0, { end: 'done' }); }, /^Error: loop fds-l2, stage done, end: an end stage comes last$/],
        [(l) => { l.stages.push({ stop: 'build' }); }, /^Error: loop fds-l2, stage build, work: the stage name repeats$/],
        [(l) => { l.stages.push({ stop: 'blocked' }); }, /^Error: loop fds-l2, stage blocked, stop: blocked is the engine's own state$/],
        [(l) => { l.stages.push({ stop: 'x', end: 'y' }); }, /^Error: loop fds-l2, stage #6, kind: a stage names exactly one of plan, gate, work, verify, stop, end$/],
        [(l) => { l.stages = []; }, /^Error: loop fds-l2, stages: list the loop's stages$/],
        [(l) => { l.stages.splice(1, 1); }, /^Error: loop fds-l2, stage plan, next: build is not a gate$/],
        [at(1, { next: 'nope' }), /^Error: loop fds-l2, stage gate1, next: nope is not a stage of the loop$/],
        [at(1, { label: undefined }), /^Error: loop fds-l2, stage gate1, label: must be a nonempty string$/],
        [(l) => { l.stages.splice(3); l.validators = {}; }, /^Error: loop fds-l2, stage build, ok: no verify stage follows to infer it from/],
        [(l) => { l.stages.splice(2, 1); l.validators = {}; }, /^Error: loop fds-l2, stage verify-build, fail: there is nothing to infer it from; state it$/],
        [(l) => { l.stages.pop(); l.validators = {}; }, /^Error: loop fds-l2, stage verify-build, pass: there is nothing to infer it from; state it$/],
        [at(3, { maxFailed: 0 }), /^Error: loop fds-l2, stage verify-build, maxFailed: must be a whole number from 1$/],
        // A stop stage no human move leaves: its gate freezes nothing, and a work stage, not a verify stage, comes before it.
        [(l) => { delete l.stages[1].freezes; l.stages.splice(3, 1); l.stages[2].dispatch.outcomes.ok = { transition: 'integrate' }; delete l.validators['verify-build']; }, /^Error: loop fds-l2, stage integrate, stop: no human move leaves this stop; give an earlier gate freezes, put a verify stage right before it, or make it an end stage$/],
        [(l) => { l.stages.splice(4, 0, { work: 'again', dispatch: l.stages[2].dispatch }, { verify: 'verify-again', dispatch: l.stages[3].dispatch, maxFailed: 2 }); }, /^Error: loop fds-l2, stage verify-again, maxFailed: verify stage verify-build has maxFailed already$/],
        // Artifacts, questions, validators, and limits.
        ...['sub/plan.md', '../plan.md', '/tmp/plan.md', '..'].map((f): [Edit, RegExp] => [artifact(f), new RegExp(`artifact plan, file: ${f.replace(/[./]/g, '\\$&')} is not a plain file name in the run folder`)]),
        [artifact('run.json'), /^Error: loop fds-l2, artifact plan, file: run\.json is a name the engine keeps$/],
        [artifact('out'), /^Error: loop fds-l2, artifact plan, file: out is a name the engine keeps$/],
        [artifact('RFC-{attempt}.md'), /^Error: loop fds-l2, artifact plan, file: RFC-\{attempt\}\.md matches the questions pattern$/],
        [artifact('diff.md'), /^Error: loop fds-l2, artifact (plan|diff), file: artifact (plan|diff) has the file diff\.md already$/],
        [(l) => { l.questions = 'RFC.md'; }, /^Error: loop fds-l2, questions: a plain file name in the run folder with one \{n\}/],
        [(l) => { l.questions = 'q/{n}.md'; }, /^Error: loop fds-l2, questions: a plain file name/],
        [(l) => { l.validators.blocked = HOOK('validator'); }, /^Error: loop fds-l2, validators\.blocked: blocked is not a stage of the loop$/],
        [(l) => { l.limits.redispatch = -1; }, /^Error: loop fds-l2, limits\.redispatch: must be a number from 0$/],
        [(l) => { delete l.result; }, /^Error: loop fds-l2, result: a hook is an object$/],
        [(l) => { l.result = { module: './hooks.mts' }; }, /^Error: loop fds-l2, result\.export: must be a nonempty string$/],
        [(l) => { l.inputs.required = 'component'; }, /^Error: loop fds-l2, inputs\.required: must be a list of names$/],
    ];
    for (const [edit, message] of refused) {
        const loop = fds();
        edit(loop);
        assert.throws(() => compileLoop(loop as LoopFile), message, String(message));
    }
    assert.throws(() => compileLoop([] as unknown as LoopFile), /^Error: loop \?, loop file: a loop file is an object$/);
    assert.doesNotThrow(() => compileLoop(fds()));
});

test('the configuration hash changes when a hook module or a module it imports changes, and only then', async () => {
    const path = copy();
    const dir = join(path, '..');
    const first = (await loadLoop(path)).sha256;
    writeFileSync(join(dir, 'notes.txt'), 'not part of the loop');
    assert.equal((await loadLoop(path)).sha256, first, 'a file no hook imports is not hashed');
    appendFileSync(join(dir, 'status.mts'), '// changed\n');
    const second = (await loadLoop(path)).sha256;
    assert.notEqual(second, first, 'a module a hook module imports is hashed');
    appendFileSync(join(dir, 'hooks.mts'), '// changed\n');
    const third = (await loadLoop(path)).sha256;
    assert.notEqual(third, second, 'a hook module is hashed');
    writeFileSync(path, JSON.stringify({ ...fds(), limits: { dispatchMinutes: 31 } }));
    assert.notEqual((await loadLoop(path)).sha256, third, 'the loop file is hashed');
});
