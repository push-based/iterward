/**
 * node --test compile-loop.spec.mts
 *
 * Proves the loop loader and the compiler: the fixture loop in `spec/loop/` compiles each step's outcomes to
 * their targets from `machine`, a `*` key included, and each gate's decisions; the loader resolves each
 * `"<file>#<export>"` hook relative to the loop file and refuses a hook it can't use; each fault refuses the
 * configuration when it loads, naming the place; and the configuration hash covers every hook module and the
 * modules it imports.
 */

import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileLoop, printable } from './compile-loop.mts';
import type { LoopFile } from './config.mts';
import { loadLoop } from './load-config.mts';

const FIXTURE = fileURLToPath(new URL('./spec/loop/', import.meta.url));
/** A fresh parsed copy of the fixture loop file. */
const parsed = (): any => JSON.parse(readFileSync(join(FIXTURE, 'fixture.loop.json'), 'utf8'));
/** A copy of the fixture folder in a temporary folder, with its loop file changed by `edit`. */
function copy(edit: (loop: any) => void = () => {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'looplock-loop-'));
    cpSync(FIXTURE, dir, { recursive: true });
    const loop = parsed();
    edit(loop);
    writeFileSync(join(dir, 'fixture.loop.json'), JSON.stringify(loop));
    return join(dir, 'fixture.loop.json');
}

test('the fixture loop compiles each outcome to its target, a * key where no specific key names the step, and each gate\'s decisions', () => {
    const config = compileLoop(parsed());
    assert.equal(config.start, 'discovery');
    assert.deepEqual(Object.fromEntries(Object.entries(config.steps).map(([s, x]) => [s, x.outcomes])), {
        discovery: { ok: 'draft', blocked: 'park' },
        supplement: { ok: 'revision', blocked: 'park' },
        draft: { ok: 'gate', 'needs-decisions': { ask: 'revision' }, 'needs-evidence': 'supplement', blocked: 'park' },
        revision: { ok: 'gate', 'needs-decisions': { ask: 'revision' }, 'needs-evidence': 'supplement', blocked: 'park' },
        build: { ok: 'verify-build', 'plan-invalidated': 'park', blocked: 'park' },
        'verify-build': { pass: 'release', fail: 'build', 'plan-invalidated': 'park', blocked: 'park' },
    });
    assert.deepEqual(config.steps.draft.writes, 'plan');
    assert.deepEqual(config.gates, { gate: { label: 'Gate', freezes: ['notes', 'plan', 'diff'], approve: 'build', reject: 'revision' } });
    assert.deepEqual(config.stops, { release: {} });
    assert.deepEqual(config.human, { build: ['revision'], 'verify-build': ['revision', 'build'], release: ['revision', 'build'] });
    assert.deepEqual(config.limits, { opens: 3 });
    assert.deepEqual(['Q-7.md', 'Q-x.md', 'Q-7.md.bak'].map((f) => config.questions!.exec(f)?.[1]), ['7', undefined, undefined]);
    const specific = parsed();
    specific.machine['build.blocked'] = 'revision';
    delete specific.limits;
    const other = compileLoop(specific);
    assert.deepEqual([other.steps.build.outcomes.blocked, other.steps.draft.outcomes.blocked, other.limits.opens], ['revision', 'park', 3], 'a specific key wins over *');
});

test('printable shows each hook as its reference and the question pattern as its source', () => {
    const out = printable(compileLoop(parsed()));
    assert.deepEqual(out.artifacts.plan, { file: 'plan.md', guard: './hooks.mts#planGuard' });
    assert.deepEqual(out.artifacts.diff, { file: 'diff.md' });
    assert.equal(out.steps['verify-build'].onEnter, './hooks.mts#onEnter');
    assert.deepEqual(out.stops, { release: { onEnter: './hooks.mts#onEnter' } });
    assert.equal(out.onAnswer, './hooks.mts#onAnswer');
    assert.equal(out.questions, String(/^Q-(\d+)\.md$/));
    assert.equal(out.hooks, undefined);
});

test('the loader resolves each hook relative to the loop file, and refuses a missing module, a missing export, and a non-function export', async () => {
    const path = copy();
    const config = await loadLoop(path);
    const mod = await import(pathToFileURL(join(path, '..', 'hooks.mts')).href);
    assert.equal(config.artifacts.plan.guard, mod.planGuard);
    assert.equal(config.artifacts.notes.guard, mod.guard);
    assert.equal(config.steps['verify-build'].onEnter, mod.onEnter);
    assert.equal(config.stops.release.onEnter, mod.onEnter);
    assert.equal(config.onAnswer, mod.onAnswer);
    assert.equal(config.preflight, mod.preflight);
    assert.equal(printable(config).preflight, './hooks.mts#preflight');
    assert.match(config.sha256, /^[0-9a-f]{64}$/);

    await assert.rejects(loadLoop(copy((l) => { l.artifacts.plan.guard = './nope.mts#guard'; })), /^Error: loop fixture, artifacts\.plan\.guard: \.\/nope\.mts can't be imported: /);
    await assert.rejects(loadLoop(copy((l) => { l.artifacts.plan.guard = './hooks.mts#readResult'; })), /^Error: loop fixture, artifacts\.plan\.guard: \.\/hooks\.mts has no export readResult$/);
    const value = copy((l) => { l.stops.release.onEnter = './value.mjs#opens'; });
    writeFileSync(join(value, '..', 'value.mjs'), 'export const opens = 3;\n');
    await assert.rejects(loadLoop(value), /^Error: loop fixture, stops\.release\.onEnter: \.\/value\.mjs's export opens is not a function$/);
    await assert.rejects(loadLoop(join(path, '..', 'missing.loop.json')), /^Error: loop file .*missing\.loop\.json: ENOENT/);
});

test('FAIL FAST: each fault refuses the configuration when it loads, naming the place', () => {
    type Edit = (l: any) => void;
    const artifact = (file: string): Edit => (l) => { l.artifacts.plan.file = file; };
    const refused: [Edit, RegExp][] = [
        // Unknown fields, at every level.
        [(l) => { l.stages = []; }, /^Error: loop fixture, stages: not a field of a loop file$/],
        [(l) => { l.inputs.extra = []; }, /^Error: loop fixture, inputs, extra: not a field of inputs$/],
        [(l) => { l.limits = { redispatch: 2 }; }, /^Error: loop fixture, limits, redispatch: not a field of limits$/],
        [(l) => { l.questions.pattern = 'x'; }, /^Error: loop fixture, questions, pattern: not a field of questions$/],
        [(l) => { l.artifacts.plan.store = 'over'; }, /^Error: loop fixture, artifact plan, store: not a field of an artifact$/],
        [(l) => { l.steps.build.message = 'Run: {runPath}.'; }, /^Error: loop fixture, step build, message: not a field of a step$/],
        [(l) => { l.gates.gate.next = 'build'; }, /^Error: loop fixture, gate gate, next: not a field of a gate$/],
        [(l) => { l.stops.release.label = 'Release'; }, /^Error: loop fixture, stop release, label: not a field of a stop$/],
        // Hooks.
        [(l) => { l.preflight = { module: './hooks.mts', export: 'preflight' }; }, /^Error: loop fixture, preflight: a hook is "<file>#<export>", the file relative to the loop file$/],
        [(l) => { l.steps.build.onEnter = './hooks.mts'; }, /^Error: loop fixture, step build, onEnter: a hook is "<file>#<export>"/],
        [(l) => { l.artifacts.plan.guard = './hooks.mts#plan-guard'; }, /^Error: loop fixture, artifact plan, guard: a hook is "<file>#<export>"/],
        // Names.
        [(l) => { l.stops.build = {}; }, /^Error: loop fixture, stop build: step build has the name already$/],
        [(l) => { l.gates.release = { label: 'R' }; }, /^Error: loop fixture, gate release: .* has the name already|^Error: loop fixture, stop release: gate release has the name already$/],
        [(l) => { l.stops.park = {}; }, /^Error: loop fixture, stop park: park is a name the engine keeps$/],
        [(l) => { l.stops.blocked = {}; }, /^Error: loop fixture, stop blocked: blocked is a name the engine keeps$/],
        [(l) => { l.stops['re.lease'] = {}; }, /^Error: loop fixture, stop re\.lease: a name takes letters, digits, _, and -$/],
        [(l) => { l.steps = {}; }, /^Error: loop fixture, steps: declare at least one step$/],
        // Steps.
        [(l) => { l.steps.build.writes = 'nope'; }, /^Error: loop fixture, step build, writes: nope is not an artifact$/],
        [(l) => { l.steps.build.writes = 'diff'; }, /^Error: loop fixture, step build, writes: artifact diff has no guard, and its guard returns the step's status$/],
        [(l) => { l.steps.build.outcomes = []; }, /^Error: loop fixture, step build, outcomes: list each outcome once$/],
        [(l) => { l.steps.build.outcomes = ['ok', 'ok']; }, /^Error: loop fixture, step build, outcomes: list each outcome once$/],
        [(l) => { l.steps.build.agent = ''; }, /^Error: loop fixture, step build, agent: must be a nonempty string$/],
        // Gates.
        [(l) => { l.gates.gate.freezes = ['plan', 'build-report']; }, /^Error: loop fixture, gate gate, freezes: build-report is written per attempt; a freeze holds one file$/],
        [(l) => { l.gates.gate.freezes = ['nope']; }, /^Error: loop fixture, gate gate, freezes: nope is not an artifact$/],
        [(l) => { l.gates.gate2 = { label: 'Gate 2', freezes: ['plan'] }; l.machine['gate2.approve'] = 'build'; l.machine['gate2.reject'] = 'revision'; }, /^Error: loop fixture, gate gate2, freezes: gate gate freezes plan already$/],
        [(l) => { delete l.gates.gate.label; }, /^Error: loop fixture, gate gate, label: must be a nonempty string$/],
        // The machine.
        [(l) => { delete l.machine.start; }, /^Error: loop fixture, machine: name the first step with "start"$/],
        [(l) => { l.machine.start = 'gate'; }, /^Error: loop fixture, machine\."start": start names a step$/],
        [(l) => { l.machine['build.done'] = 'verify-build'; }, /^Error: loop fixture, machine\."build\.done": step build declares no outcome done; its outcomes are ok, plan-invalidated, blocked$/],
        [(l) => { l.machine['*.done'] = 'park'; }, /^Error: loop fixture, machine\."\*\.done": no step declares the outcome done$/],
        [(l) => { l.machine['nope.ok'] = 'build'; }, /^Error: loop fixture, machine\."nope\.ok": a key is "start"/],
        [(l) => { l.machine['release.ok'] = 'build'; }, /^Error: loop fixture, machine\."release\.ok": a key is "start"/],
        [(l) => { l.machine['gate.pass'] = 'build'; }, /^Error: loop fixture, machine\."gate\.pass": a gate takes approve and reject$/],
        [(l) => { l.machine['build.ok'] = 'nope'; }, /^Error: loop fixture, machine\."build\.ok": a target is a step, a gate, a stop, park, or \{ "ask": STEP \}, not "nope"$/],
        [(l) => { l.machine['build.ok'] = 'blocked'; }, /^Error: loop fixture, machine\."build\.ok": a target is a step/],
        [(l) => { l.machine['build.ok'] = { ask: 'gate' }; }, /^Error: loop fixture, machine\."build\.ok": ask names the step that runs after the answers, and gate is not a step$/],
        [(l) => { l.machine['build.ok'] = { ask: 'build', park: true }; }, /^Error: loop fixture, machine\."build\.ok": a target is a step/],
        [(l) => { delete l.questions; }, /^Error: loop fixture, machine\."draft\.needs-decisions": ask needs the loop's questions$/],
        [(l) => { l.machine['gate.approve'] = 'park'; }, /^Error: loop fixture, machine\."gate\.approve": a gate decision goes to a step, a gate, or a stop, not "park"$/],
        [(l) => { l.machine['gate.reject'] = { ask: 'revision' }; }, /^Error: loop fixture, machine\."gate\.reject": a gate decision goes to a step, a gate, or a stop/],
        [(l) => { delete l.machine['*.blocked']; }, /^Error: loop fixture, step discovery, outcomes: the machine has no "discovery\.blocked" and no "\*\.blocked"$/],
        [(l) => { delete l.machine['gate.reject']; }, /^Error: loop fixture, gate gate: the machine has no "gate\.reject"$/],
        [(l) => { l.machine = []; }, /^Error: loop fixture, machine: must map "start" and each "<step>\.<outcome>" to its target$/],
        // Human moves.
        [(l) => { l.human.gate = ['build']; }, /^Error: loop fixture, human\.gate: gate is not a step or a stop; a gate's moves are its decisions$/],
        [(l) => { l.human.build = ['nope']; }, /^Error: loop fixture, human\.build: nope is not a step, gate, or stop of the loop$/],
        [(l) => { l.human.build = 'revision'; }, /^Error: loop fixture, human\.build: must be a list of names$/],
        // Artifacts, questions, and limits.
        ...['sub/plan.md', '../plan.md', '/tmp/plan.md', '..'].map((f): [Edit, RegExp] => [artifact(f), new RegExp(`artifact plan, file: ${f.replace(/[./]/g, '\\$&')} is not a plain file name in the run folder`)]),
        [artifact('run.json'), /^Error: loop fixture, artifact plan, file: run\.json is a name the engine keeps$/],
        [artifact('out'), /^Error: loop fixture, artifact plan, file: out is a name the engine keeps$/],
        [artifact('Q-{attempt}.md'), /^Error: loop fixture, artifact plan, file: Q-\{attempt\}\.md matches the questions pattern$/],
        [artifact('diff.md'), /^Error: loop fixture, artifact (plan|diff), file: artifact (plan|diff) has the file diff\.md already$/],
        [(l) => { l.questions.file = 'Q.md'; }, /^Error: loop fixture, questions\.file: a plain file name in the run folder with one \{n\}/],
        [(l) => { l.questions = 'Q-{n}.md'; }, /^Error: loop fixture, questions: questions is an object$/],
        [(l) => { l.limits = { opens: 0 }; }, /^Error: loop fixture, limits\.opens: must be a whole number from 1$/],
        [(l) => { l.limits = { opens: 2.5 }; }, /^Error: loop fixture, limits\.opens: must be a whole number from 1$/],
        [(l) => { l.inputs.required = 'subject'; }, /^Error: loop fixture, inputs\.required: must be a list of names$/],
    ];
    for (const [edit, message] of refused) {
        const loop = parsed();
        edit(loop);
        assert.throws(() => compileLoop(loop as LoopFile), message, String(message));
    }
    assert.throws(() => compileLoop([] as unknown as LoopFile), /^Error: loop \?, loop file: a loop file is an object$/);
    assert.doesNotThrow(() => compileLoop(parsed()));
    const terminal = parsed();
    delete terminal.human.release;
    assert.doesNotThrow(() => compileLoop(terminal), 'a stop with no human moves is terminal');
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
    writeFileSync(path, JSON.stringify({ ...parsed(), limits: { opens: 4 } }));
    assert.notEqual((await loadLoop(path)).sha256, third, 'the loop file is hashed');
});
