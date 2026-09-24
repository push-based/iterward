/**
 * node --test tools/scripts/looplock/engine.spec.mts
 *
 * Proves the engine's invariants on a neutral two-phase loop (the shape the pack's first consumer uses,
 * with neutral guards), the next/result protocol and its limits, the default preset end to end, and that
 * the engine holds no consumer vocabulary.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { activeDecisionIds, defineLoop, loop, pendingQuestions, type Doc, type Run } from './engine.mts';
import preset from './presets/default.mts';

/* ------------------------------------------------------------------ a neutral two-phase loop */

const SPEC = defineLoop({
    name: 'spec',
    inputs: { required: ['subject'], optional: ['link'] },
    initial: 'plan',
    states: {
        plan: ['gate1', 'blocked'],
        gate1: ['build', 'plan', 'blocked'],
        build: ['verify-build', 'blocked'],
        'verify-build': ['blocked'],
        integrate: ['verify-integration', 'blocked'],
        'verify-integration': ['blocked'],
        gate2: ['done', 'build', 'blocked'],
        done: [],
        blocked: ['plan', 'gate1', 'build', 'verify-build', 'integrate', 'verify-integration', 'gate2'],
    },
    artifacts: {
        evidence: { store: 'over', guard: (doc) => ('decisions' in doc ? ['/decisions evidence holds facts only'] : []) },
        architecture: { store: 'over', projection: 'named' },
        contract: {
            store: 'versioned',
            requires: 'architecture',
            projection: 'all',
            guard: (doc, { docs }) => [
                ...(Array.isArray(doc.obligations) ? [] : ['/obligations required section missing']),
                ...(docs.evidence?.consumers ?? []).filter((c: Doc) => !(doc.consumers ?? []).some((x: Doc) => x.file === c.file && x.line === c.line)).map((c: Doc) => `consumers: ${c.file}:${c.line} from the evidence is missing from the contract`),
            ],
        },
    },
    gates: {
        gate1: { label: 'Gate 1', freezes: 'contract', requires: ['evidence'], next: 'build', back: 'plan', scopes: { architecture: {}, values: { restamp: ['architecture'] } } },
        gate2: { label: 'Gate 2', next: 'done', back: 'build' },
    },
    verify: {
        'verify-build': { phase: 'build', pass: 'integrate', fail: 'build', checks: true },
        'verify-integration': { phase: 'integration', pass: 'gate2', fail: 'integrate' },
    },
    invalidate: { from: ['build', 'verify-build', 'integrate', 'verify-integration'], to: 'plan', proofFrom: ['verify-build', 'verify-integration'] },
    revoke: { phase: 'build', at: 'integrate', to: 'build' },
    checks: { ignore: [], rows: () => {} },
});
const L = loop(SPEC);

const tmp = () => join(mkdtempSync(join(tmpdir(), 'looplock-')), 'run.json');
const contractDoc = (extra = {}) => ({ ruling: { value: 'cleanup' }, obligations: [], consumers: [], visualChanges: [], ...extra });
let drafts = 0;
function draft(runPath: string, extra = {}) {
    const p = join(dirname(runPath), `draft-${++drafts}.json`);
    writeFileSync(p, JSON.stringify(contractDoc(extra)));
    return p;
}
/** Both planning stages from one file: the architecture first, as the contract requires. */
function storeContract(p: string, r: Run, file: string) {
    if (r.status === 'plan') L.store(p, r, 'architecture', file);
    return L.store(p, r, 'contract', file);
}
function evidence(p: string, r: Run, doc: Doc = { consumers: [] }) {
    const f = join(dirname(p), 'evidence-draft.json');
    writeFileSync(f, JSON.stringify(doc));
    return L.store(p, r, 'evidence', f);
}
const newRun = () => L.newRun({ subject: 'x' });
const checked = (r: Run) => L.recordChecks(r, { attempt: L.attemptOf(r, 'build'), path: `checks.${L.attemptOf(r, 'build')}.json`, pass: true, failed: 0, blocked: 0 });
function verify(r: Run, phase: string, verdict: string, proof: string, obligations: Record<string, string> = {}) {
    if (verdict === 'pass' && phase === 'build' && r.status === 'verify-build') checked(r);
    return L.recordVerification(r, phase, verdict, proof, obligations);
}
function savedAtBuild() {
    const p = tmp();
    const r = newRun();
    evidence(p, r);
    storeContract(p, r, draft(p, { ruling: { value: 'cleanup' } }));
    L.transition(r, 'gate1');
    L.approve(r, 'gate1');
    L.saveRun(p, r);
    return p;
}
function drive(to: string, obligations: Doc[] = []) {
    const p = tmp();
    const r = newRun();
    evidence(p, r);
    storeContract(p, r, draft(p, { obligations }));
    L.transition(r, 'gate1');
    if (to === 'gate1') return r;
    L.approve(r, 'gate1');
    if (to === 'build') return r;
    L.transition(r, 'verify-build');
    if (to === 'verify-build') return r;
    verify(r, 'build', 'pass', 'proof:1', Object.fromEntries(obligations.filter((o) => o.phase === 'build').map((o) => [o.id, o.tier])));
    if (to === 'integrate') return r;
    L.transition(r, 'verify-integration');
    if (to === 'verify-integration') return r;
    verify(r, 'integration', 'pass', 'proof:2');
    return r;
}

test('newRun starts at the initial state with its inputs; save/load round-trips and checks shape', () => {
    const p = tmp();
    L.saveRun(p, L.newRun({ subject: 'packages/x/progress', link: 'https://design.example.com/file/1' }));
    assert.deepEqual([L.loadRun(p).status, L.loadRun(p).inputs.link], ['plan', 'https://design.example.com/file/1']);
    assert.throws(() => L.newRun({}), /needs --subject/);
    const r = newRun();
    r.status = 'nope';
    assert.throws(() => L.saveRun(tmp(), r), /invalid run shape/);
});

test('the happy path reaches gate2 through both verify phases; a gate exit needs its approval', () => {
    const r = drive('gate2');
    assert.deepEqual(r.history.map((h) => h.to), ['gate1', 'build', 'verify-build', 'integrate', 'verify-integration', 'gate2']);
    assert.throws(() => L.transition(r, 'done'), /requires Gate 2 approval/);
    assert.throws(() => L.transition(drive('gate1'), 'build'), /requires Gate 1 approval/);
    assert.throws(() => L.transition(drive('build'), 'integrate'), /illegal transition build/);
});

test('a verify boundary cannot be crossed by a bare transition; a verdict is the path', () => {
    const r = drive('verify-build');
    assert.throws(() => L.transition(r, 'integrate'), /illegal transition/);
    assert.throws(() => L.transition(r, 'build'), /illegal transition/);
    const r2 = drive('verify-integration');
    assert.throws(() => L.transition(r2, 'gate2'), /illegal transition/);
    assert.throws(() => L.transition(r2, 'integrate'), /illegal transition/);
});

test('a stale verdict from an earlier attempt cannot ride a bare transition out of a re-entered verify state', () => {
    const r = drive('verify-build');
    verify(r, 'build', 'fail', 'verify-build.1.report.md');
    L.transition(r, 'verify-build');
    assert.throws(() => L.transition(r, 'build'), /illegal transition/);
    assert.equal(r.status, 'verify-build');
});

test('a verdict routes: pass forward, fail back; it needs the right state and a proof reference', () => {
    const r = drive('verify-build');
    verify(r, 'build', 'fail', 'proof:x');
    assert.equal(r.status, 'build');
    const r2 = drive('verify-integration');
    verify(r2, 'integration', 'fail', 'proof:y');
    assert.equal(r2.status, 'integrate');
    assert.throws(() => verify(drive('build'), 'build', 'pass', 'proof:z'), /needs status verify-build/);
    assert.throws(() => verify(drive('verify-build'), 'build', 'pass', '  '), /requires a non-empty proof/);
    assert.throws(() => verify(drive('verify-build'), 'nope', 'pass', 'p'), /--phase must be one of build, integration/);
});

test('a verdict or a block cannot cite a proof the run already cites', () => {
    const r = drive('verify-build');
    verify(r, 'build', 'fail', 'verify-build.2.report.md');
    L.transition(r, 'verify-build');
    assert.throws(() => verify(r, 'build', 'fail', 'verify-build.2.report.md'), /already cited/);
    assert.throws(() => L.transition(r, 'blocked', 'unreachable obligation', 'verify-build.2.report.md'), /already cited/);
    L.transition(r, 'blocked', 'unreachable obligation', 'verify-build.3.report.md');
    // A human re-open may cite the blocking report it is resolving.
    assert.equal(L.invalidate(r, { reason: 'the obligation needs a render', proof: 'verify-build.3.report.md' }).status, 'plan');
});

test('every attempt is kept; a passing retry never overwrites a failed proof', () => {
    const r = drive('verify-build');
    verify(r, 'build', 'fail', 'verify-build.1.report.md');
    L.transition(r, 'verify-build');
    verify(r, 'build', 'pass', 'verify-build.2.report.md');
    assert.deepEqual([r.verifications!.build.verdict, r.verifications!.build.proof], ['pass', 'verify-build.2.report.md']);
    assert.deepEqual(r.verifications!.build.attempts.map((a: Doc) => a.proof), ['verify-build.1.report.md', 'verify-build.2.report.md']);
});

test('INVARIANT: the gate freezes its artifact and only invalidate re-opens it', () => {
    const p = savedAtBuild();
    const tampered = L.loadRun(p);
    tampered.artifacts.contract = { ...tampered.artifacts.contract, sha256: 'x' };
    assert.throws(() => L.saveRun(p, tampered), /frozen after Gate 1/);
    assert.throws(() => storeContract(p, L.loadRun(p), draft(p, { ruling: { value: 'split' } })), /only allowed at status plan/);

    const reopened = L.invalidate(L.loadRun(p), { reason: 'a sibling uses it', refs: ['a.scss:12'] });
    assert.equal(reopened.status, 'plan');
    assert.equal(reopened.gates.gate1.decision, undefined, 'the approval is cleared');
    assert.equal(reopened.gates.gate1.history.length, 1, 'the candidate history stays');
    assert.deepEqual([reopened.invalidations![0].retired.path, reopened.invalidations![0].refs], ['contract.1.json', ['a.scss:12']]);
    L.saveRun(p, reopened);
    storeContract(p, reopened, draft(p, { ruling: { value: 'split' } }));
    L.saveRun(p, reopened);
    assert.equal(L.loadRun(p).docs!.contract.ruling.value, 'split');
    assert.equal(L.loadRun(p).artifacts.contract.path, 'contract.2.json', 'the re-plan gets the next file');
    assert.equal(JSON.parse(readFileSync(join(dirname(p), 'contract.1.json'), 'utf8')).ruling.value, 'cleanup', 'the retired file stays');
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).docs, undefined, 'the run file holds only the refs');
});

test('an artifact file edited after its store is refused on every load', () => {
    const p = savedAtBuild();
    const file = join(dirname(p), 'contract.1.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('cleanup', 'split'));
    assert.throws(() => L.loadRun(p), /changed since store contract/);
});

test('store refuses a document its guard refuses, one that drops an evidence fact, and one without its required stage', () => {
    const p = tmp();
    const r = newRun();
    assert.throws(() => L.store(p, r, 'contract', draft(p)), /needs this cycle's architecture: run store architecture first/);
    assert.throws(() => storeContract(p, r, draft(p, { obligations: undefined })), /\/obligations required section missing/);
    evidence(p, r, { consumers: [{ file: 'a.ts', line: 3 }] });
    assert.throws(() => L.store(p, r, 'contract', draft(p)), /a\.ts:3 from the evidence is missing/);
    assert.throws(() => L.store(p, r, 'nope', draft(p)), /store takes evidence, architecture, contract, not nope/);
});

test('a human revokes a recorded build pass from integrate; the revoked attempt counts and returns the run to build', () => {
    const r = drive('integrate');
    assert.throws(() => L.revokeVerification(drive('verify-build'), 'build', 'why', 'review-build.1.md'), /needs status integrate/);
    assert.throws(() => L.revokeVerification(r, 'integration', 'why', 'review-build.1.md'), /build phase only/);
    assert.throws(() => L.revokeVerification(r, 'build', ' ', 'review-build.1.md'), /needs a note/);
    assert.throws(() => L.revokeVerification(r, 'build', 'why', 'proof:1'), /already cited/);
    L.revokeVerification(r, 'build', 'triage never ran', 'review-build.1.md');
    assert.equal(r.status, 'build');
    assert.deepEqual(r.verifications!.build.attempts.map((a: Doc) => a.verdict), ['pass', 'revoked']);
});

test('invalidate: after the freeze only, needs a reason, and a verify origin needs its proof report', () => {
    assert.throws(() => L.invalidate(drive('gate1'), { reason: 'x' }), /invalidate needs one of build, verify-build, integrate, verify-integration, not gate1/);
    assert.throws(() => L.invalidate(drive('build'), {}), /needs a reason/);
    assert.equal(L.invalidate(drive('build'), { reason: 'a consumer the contract missed', refs: ['b.ts:9'] }).status, 'plan', 'a builder invalidation needs no report');
    assert.throws(() => L.invalidate(drive('verify-build'), { reason: 'contradictory frozen claims' }), /requires its proof report/);
    const r = L.invalidate(drive('verify-build'), { reason: 'contradictory frozen claims', refs: ['contract.json:44'], proof: 'verify-build.1.report.md' });
    assert.deepEqual([r.status, r.invalidations!.at(-1).proof, r.invalidations!.at(-1).from], ['plan', 'verify-build.1.report.md', 'verify-build']);
});

test('a pass is refused until every obligation of the phase is proven in exactly its evidence mode', () => {
    const obligations = [
        { id: 'O1', phase: 'build', claim: 'the label resolves to 16px', tier: 'STATIC_EVIDENCE' },
        { id: 'O2', phase: 'integration', claim: 'the bar renders 8px tall in the tile', tier: 'LIVE_RENDER' },
    ];
    const atVerifyBuild = () => checked(drive('verify-build', obligations));
    assert.throws(() => L.recordVerification(atVerifyBuild(), 'build', 'pass', 'r.md'), /unmet: O1 \(STATIC_EVIDENCE\)$/);
    assert.throws(() => L.recordVerification(atVerifyBuild(), 'build', 'pass', 'r.md', { O1: 'LIVE_RENDER' }), /unmet: O1/, 'modes are not ranked');
    assert.equal(L.recordVerification(atVerifyBuild(), 'build', 'pass', 'r.md', { O1: 'STATIC_EVIDENCE' }).status, 'integrate', 'O2 does not gate the build pass');
    assert.throws(() => verify(drive('verify-integration', obligations), 'integration', 'pass', 'i.md', { O2: 'STATIC_EVIDENCE' }), /unmet: O2 \(LIVE_RENDER\)/);
    assert.equal(verify(drive('verify-integration', obligations), 'integration', 'pass', 'i.md', { O2: 'LIVE_RENDER' }).status, 'gate2');
    assert.equal(verify(drive('verify-build', obligations), 'build', 'fail', 'f.md').status, 'build', 'a fail needs no obligation proof');
});

test('blocked records origin, reason, and report, and resumes ONLY into it; a run parked before the freeze cannot be invalidated', () => {
    const r = drive('verify-build');
    assert.throws(() => L.transition(r, 'blocked'), /needs a note/);
    L.transition(r, 'blocked', 'O2 needs LIVE_RENDER; no render available', 'verify-build.3.report.md');
    assert.equal(r.blockedFrom, 'verify-build');
    assert.throws(() => L.transition(r, 'build'), /resumes only into verify-build/);
    assert.throws(() => L.invalidate(r, { reason: 'x' }), /requires its proof report/);
    L.transition(r, 'verify-build');
    assert.equal(r.blockedFrom, undefined);
    const early = drive('gate1');
    L.transition(early, 'blocked', 'escalated decision');
    assert.throws(() => L.invalidate(early, { reason: 'x' }), /not blocked \(blocked from gate1\)/);
});

test('a gate cannot be reached or approved without its artifact', () => {
    const r = newRun();
    assert.throws(() => L.transition(r, 'gate1'), /needs a contract/);
    r.status = 'gate1';
    assert.throws(() => L.approve(r, 'gate1'), /needs a contract/);
    assert.throws(() => L.approve(r, 'gate9'), /gate takes gate1, gate2, not gate9/);
});

/* ------------------------------------------------------------------ decision ledger */

const Q = (question: string, extra = {}) => ({ topic: question, question, options: ['A. keep both couplings', 'B. per-theme values'], recommendation: 'A — the legacy renders it', ...extra });

test('LEDGER: ask stores snapshots with engine ids; answer copies the chosen option text', () => {
    const r = newRun();
    assert.deepEqual(L.askQuestions(r, [Q('overlay?'), Q('paused?')]).map((q) => q.id), ['D1', 'D2']);
    assert.deepEqual(pendingQuestions(r).map((q) => q.id), ['D1', 'D2']);
    assert.equal(L.answerQuestion(r, { id: 'D1', option: 'A', answer: '1 - A' }).chosenText, 'A. keep both couplings');
    assert.throws(() => L.answerQuestion(r, { id: 'D1', option: 'B', answer: 'again' }), /already answered/);
    assert.throws(() => L.answerQuestion(r, { id: 'D2', option: 'C', answer: 'C' }), /not an option/);
    assert.throws(() => L.answerQuestion(r, { id: 'D2', option: 'A' }), /human's words/);
    assert.throws(() => L.answerQuestion(r, { id: 'D9', option: 'A', answer: 'x' }), /no question D9/);
    L.answerQuestion(r, { id: 'D2', custom: 'grey only in standard', answer: 'grey only in standard' });
    assert.deepEqual([...activeDecisionIds(r)], ['D1', 'D2']);
    assert.equal(L.askQuestions(r, [Q('size?')])[0].id, 'D3', 'ids continue across asks');
});

test('LEDGER: ask checks the whole list first and refuses bad questions, duplicates, and inactive supersedes', () => {
    const r = newRun();
    assert.throws(() => L.askQuestions(r, [Q('ok?'), { question: 'one option', options: ['A. only'], recommendation: 'A' }]), /at least 2 options/);
    assert.equal((r.questions ?? []).length, 0, 'nothing stored when one question is bad');
    assert.throws(() => L.askQuestions(r, [Q('x?', { options: ['A. a', 'A. b'] })]), /own capital-letter key/);
    assert.throws(() => L.askQuestions(r, [Q('x?', { recommendation: '' })]), /recommendation/);
    assert.throws(() => L.askQuestions(r, [Q('x?', { supersedes: 'D1' })]), /not an active decision/);
    L.askQuestions(r, [Q('x?')]);
    assert.throws(() => L.askQuestions(r, [Q('x?')]), /already pending/);
    L.answerQuestion(r, { id: 'D1', option: 'A', answer: 'A' });
    assert.throws(() => L.askQuestions(r, [Q('x?')]), /D1 already resolves this question/);
    assert.equal(L.askQuestions(r, [Q('x?', { supersedes: 'D1' })])[0].id, 'D2');
    r.status = 'build';
    assert.throws(() => L.askQuestions(r, [Q('y?')]), /only allowed at status plan/);
});

test('LEDGER: a later decision supersedes an active one; the superseded one can no longer be projected', () => {
    const r = newRun();
    L.askQuestions(r, [Q('overlay?')]);
    L.answerQuestion(r, { id: 'D1', option: 'A', answer: 'A' });
    L.askQuestions(r, [Q('overlay, again?', { supersedes: 'D1' })]);
    L.answerQuestion(r, { id: 'D2', option: 'B', answer: 'B' });
    assert.deepEqual([...activeDecisionIds(r)], ['D2']);
    const doc = { visualChanges: ['x'], decisionsApplied: [{ id: 'D1', pointers: ['/visualChanges/0'] }] };
    assert.match(L.projectionErrors(r, doc).join(), /D1, which a later decision superseded/);
    assert.match(L.projectionErrors(r, doc).join(), /active decision D2 is not projected/);
    assert.deepEqual(L.projectionErrors(r, { decisionsApplied: [{ id: 'D2', pointers: ['/visualChanges/0'] }] }), []);
});

test('GATE: refused while a question is pending, a decision is unprojected, or a required artifact is missing', () => {
    const p = tmp();
    const r = newRun();
    storeContract(p, r, draft(p, { visualChanges: ['x'] }));
    assert.throws(() => L.transition(r, 'gate1'), /needs the evidence/);
    evidence(p, r);
    L.askQuestions(r, [Q('overlay?')]);
    assert.throws(() => L.transition(r, 'gate1'), /pending: D1/);
    L.answerQuestion(r, { id: 'D1', option: 'A', answer: 'A' });
    assert.throws(() => L.transition(r, 'gate1'), /D1 is not projected/);
    storeContract(p, r, draft(p, { visualChanges: ['x'], decisionsApplied: [{ id: 'D1', pointers: ['/visualChanges/0'] }] }));
    L.transition(r, 'gate1');
    L.approve(r, 'gate1');
    assert.equal(r.status, 'build');
});

test('CANDIDATES: every versioned store writes a new file; each gate answer records the candidate it judged', () => {
    const p = tmp();
    const r = newRun();
    evidence(p, r);
    storeContract(p, r, draft(p, { ruling: { value: 'one' } }));
    L.transition(r, 'gate1');
    L.reject(r, 'gate1', 'G1 versus G2 for appearance', { scope: 'architecture' });
    assert.equal(r.status, 'plan');
    storeContract(p, r, draft(p, { ruling: { value: 'two' } }));
    assert.equal(r.artifacts.contract.path, 'contract.2.json');
    assert.equal(JSON.parse(readFileSync(join(dirname(p), 'contract.1.json'), 'utf8')).ruling.value, 'one', 'the rejected candidate stays on disk');
    L.transition(r, 'gate1');
    L.approve(r, 'gate1');
    assert.deepEqual(r.gates.gate1.history.map((h: Doc) => [h.judged.path, h.decision, h.note]), [['contract.1.json', 'rejected', 'G1 versus G2 for appearance'], ['contract.2.json', 'approved', undefined]]);
});

test('REJECT: needs the words and a scope; a restamping scope keeps the artifact current; supersedes records the words', () => {
    const p = tmp();
    const r = newRun();
    evidence(p, r);
    L.askQuestions(r, [Q('fill?')]);
    L.answerQuestion(r, { id: 'D1', option: 'A', answer: 'A' });
    storeContract(p, r, draft(p, { visualChanges: ['x'], decisionsApplied: [{ id: 'D1', pointers: ['/visualChanges/0'] }] }));
    L.transition(r, 'gate1');
    assert.throws(() => L.reject(r, 'gate1', ' ', { scope: 'values' }), /needs --note/);
    assert.throws(() => L.reject(r, 'gate1', 'n', { scope: 'tokens' }), /needs --scope architecture\|values/);
    assert.throws(() => L.reject(r, 'gate1', 'n', { scope: 'values', supersedes: 'D9' }), /D9 is not an active decision/);
    assert.equal(r.status, 'gate1', 'a refused rejection records nothing');
    L.reject(r, 'gate1', 'keep the value', { scope: 'values', supersedes: 'D1' });
    assert.deepEqual([...activeDecisionIds(r)], ['D2']);
    assert.ok(r.artifacts.architecture.seq > r.artifacts.contract.seq, 'the architecture is current for the next contract');
    L.store(p, r, 'contract', draft(p, { visualChanges: ['x'], decisionsApplied: [{ id: 'D2', pointers: ['/visualChanges/0'] }] }));
});

test('EVIDENCE: an `over` store rewrites <name>.stored.json and counts; hash-checked on load; refused outside plan', () => {
    const p = tmp();
    const r = newRun();
    const bad = join(dirname(p), 'bad.json');
    writeFileSync(bad, JSON.stringify({ decisions: [] }));
    assert.throws(() => L.store(p, r, 'evidence', bad), /facts only/);
    evidence(p, r);
    evidence(p, r, { consumers: [], designSource: 'none' });
    assert.deepEqual([r.artifacts.evidence.path, r.artifacts.evidence.n], ['evidence.stored.json', 2]);
    L.saveRun(p, r);
    writeFileSync(join(dirname(p), 'evidence.stored.json'), JSON.stringify({ designSource: 'figma' }));
    assert.throws(() => L.loadRun(p), /evidence.stored.json changed since store evidence/);
    r.status = 'build';
    assert.throws(() => evidence(p, r), /only allowed at status plan/);
});

test('PASS GUARD: a pass of a checked phase needs an all-pass checks record for the same attempt', () => {
    const r = drive('verify-build');
    assert.throws(() => L.recordVerification(r, 'build', 'pass', 'p:1'), /needs `checks` for this build attempt \(1\)/);
    L.recordChecks(r, { attempt: 1, path: 'checks.1.json', pass: false, failed: 1, blocked: 0 });
    assert.throws(() => L.recordVerification(r, 'build', 'pass', 'p:2'), /1 failed and 0 blocked/);
    L.recordVerification(r, 'build', 'fail', 'p:3');
    L.transition(r, 'verify-build');
    L.recordChecks(r, { attempt: 1, path: 'checks.1.json', pass: true, failed: 0, blocked: 0 });
    assert.throws(() => L.recordVerification(r, 'build', 'pass', 'p:4'), /build attempt \(2\)/, 'checks from an earlier attempt are stale');
    L.recordChecks(r, { attempt: 2, path: 'checks.2.json', pass: false, failed: 0, blocked: 1 });
    assert.throws(() => L.recordVerification(r, 'build', 'pass', 'p:5'), /1 blocked/);
    L.recordChecks(r, { attempt: 2, path: 'checks.2-2.json', pass: true, failed: 0, blocked: 0 });
    L.recordVerification(r, 'build', 'pass', 'p:6');
    assert.equal(r.status, 'integrate');
});

/* ------------------------------------------------------------------ next and result */

/** A loop on the default preset with its dispatches, driven through next/result with result files. */
function presetRun() {
    const P = loop(preset);
    const p = tmp();
    const r = P.newRun({ subject: 'the offers tile' });
    /** The agent side: write the dispatched result file, then read the next move. */
    const reply = (doc: Doc) => {
        const d = r.dispatches!.at(-1)!;
        writeFileSync(d.result, typeof doc === 'string' ? doc : JSON.stringify(doc));
        return P.result(p, r);
    };
    const file = (name: string, doc: Doc) => {
        const f = join(dirname(p), name);
        writeFileSync(f, JSON.stringify(doc));
        return f;
    };
    return { P, p, r, reply, file, next: () => P.next(p, r) };
}

test('NEXT: an open dispatch comes back unchanged; its message names the result file', () => {
    const { p, r, next } = presetRun();
    const first = next();
    assert.deepEqual([first.do, first.id, first.agent], ['dispatch', 1, 'planner']);
    assert.equal(first.message, `Plan the offers tile. Run: ${p}. Result: ${join(dirname(p), 'results', '1.json')}.`);
    assert.deepEqual(next(), first, 'next is idempotent while the dispatch is open');
    assert.equal(r.dispatches!.length, 1);
});

test('RESULT: an unusable result is re-dispatched once with Fixes, and the second parks the run', () => {
    const { P, p, r, reply, next } = presetRun();
    next();
    const again = P.result(p, r);
    assert.match(again.message, /Fixes: no result file at .*1\.json; write the result JSON there/);
    assert.equal(again.id, 2);
    const parked = reply('{ not json');
    assert.deepEqual([parked.do, parked.stop, r.status], ['stop', 'blocked', 'blocked']);
    assert.match(parked.reason, /planner returned no usable result twice: the result file is not JSON/);
    assert.deepEqual(parked.since.map((d: Doc) => d.outcome), ['unusable', 'unusable']);
});

test('RESULT: a status the loop does not know, or a missing field, is unusable', () => {
    const { reply, next } = presetRun();
    next();
    assert.match(reply({ status: 'done' }).message, /Fixes: the result status must be one of ok, needs-decisions, not done/);
    const { reply: reply2, next: next2 } = presetRun();
    next2();
    assert.match(reply2({ status: 'ok' }).message, /Fixes: a ok result needs plan/);
});

test('RESULT: a refused action is re-dispatched with the refusal; the third refusal in a row parks', () => {
    const { r, reply, next } = presetRun();
    next();
    const missing = { status: 'ok', plan: '/nonexistent/plan.json' };
    assert.match(reply(missing).message, /^Plan the offers tile\. Run: .*\. Fixes: ENOENT.*Result: .*2\.json\.$/);
    reply(missing);
    const parked = reply(missing);
    assert.deepEqual([parked.stop, r.status], ['blocked', 'blocked']);
    assert.match(parked.reason, /ENOENT/);
});

test('RESULT: ask stops for the human with the result gaps; the answer lets the loop go on', () => {
    const { P, r, reply, file, next } = presetRun();
    next();
    const stop = reply({ status: 'needs-decisions', questions: file('q.json', [Q('scope?')]), gaps: [{ topic: 'design', detail: 'no link' }] });
    assert.deepEqual([stop.stop, stop.questions.map((q: Doc) => q.id), stop.gaps[0].topic], ['questions', ['D1'], 'design']);
    assert.deepEqual(next().since, stop.since, 'the same stop repeats its records');
    P.answerQuestion(r, { id: 'D1', option: 'A', answer: 'A' });
    assert.equal(next().agent, 'planner');
});

test('THE DEFAULT PRESET: plan → gate → build → verify → done, and three failed verifications park the run', () => {
    const { P, p, r, reply, file, next } = presetRun();
    next();
    const gate = reply({ status: 'ok', plan: file('plan.json', { steps: ['a'], obligations: [] }) });
    assert.deepEqual([gate.stop, gate.gate, r.status], ['gate', 'gate', 'gate']);
    P.reject(r, 'gate', 'split the plan');
    assert.match(next().message, /Notes: \[\{"from":"gate","note":"split the plan"\}\]/);
    reply({ status: 'ok', plan: file('plan2.json', { steps: ['a', 'b'], obligations: [] }) });
    P.approve(r, 'gate');
    assert.equal(next().agent, 'builder');
    assert.equal(reply({ status: 'ok' }).agent, 'verifier');
    const report = (n: number) => file(`verify.${n}.md`, '# report');
    for (const n of [1, 2]) {
        assert.equal(reply({ status: 'fail', report: report(n) }).agent, 'builder');
        reply({ status: 'ok' });
    }
    const parked = reply({ status: 'fail', report: report(3) });
    assert.deepEqual([parked.stop, parked.blockedFrom], ['blocked', 'build']);
    assert.match(parked.reason, /3 failed verifications since the gate; latest report .*verify\.3\.md/);
    P.transition(r, 'build');
    P.invalidate(r, { reason: 'the plan missed a consumer' });
    assert.equal(next().agent, 'planner');
    reply({ status: 'ok', plan: file('plan3.json', { steps: ['a', 'b', 'c'], obligations: [] }) });
    P.approve(r, 'gate');
    next();
    reply({ status: 'ok' });
    const done = reply({ status: 'pass', report: report(4) });
    assert.deepEqual([done.stop, done.status], ['status', 'done']);
    assert.equal(P.saveRun(p, r).status, 'done');
});

/* ------------------------------------------------------------------ the consumer boundary */

test('the engine holds no consumer vocabulary', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.m?ts$|\.md$|\.json$/.test(f) && !f.endsWith('.spec.mts'));
    const words = /\bfds\b|themepark|brand|\btokens?\b|scss|kiro|\b[lL][123]\b/;
    const hits = files.flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => (words.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null)).filter(Boolean));
    assert.deepEqual(hits, []);
});
