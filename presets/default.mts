/**
 * The default loop: a planner writes a plan, a human approves it at the gate, a builder implements it,
 * and a verifier proves the build against the frozen plan.
 *
 *   plan → gate → build → verify → done
 *
 * A rejection or an invalidation sends the run back to the planner with the human's words in `notes`.
 * Copy this file to start a loop of your own.
 */

import { defineLoop } from '../engine.mts';

export default defineLoop({
    name: 'default',
    inputs: { required: ['subject'] },
    initial: 'plan',
    states: {
        plan: ['gate', 'blocked'],
        gate: ['build', 'plan', 'blocked'],
        build: ['verify', 'blocked'],
        verify: ['blocked'],
        done: [],
        blocked: ['plan', 'gate', 'build', 'verify'],
    },
    artifacts: { plan: { store: 'versioned', projection: 'all' } },
    gates: { gate: { label: 'Gate', freezes: 'plan', next: 'build', back: 'plan' } },
    verify: { verify: { phase: 'build', pass: 'done', fail: 'build' } },
    invalidate: { from: ['build', 'verify'], to: 'plan', proofFrom: ['verify'] },
    // The gate judges each stored plan once: a rejected or invalidated plan goes back to the planner.
    route: ({ run }) => {
        const plan = run.artifacts.plan;
        const judged = run.gates.gate?.history?.at(-1)?.judged?.path;
        const retired = run.invalidations?.at(-1)?.retired?.path;
        return plan && plan.path !== judged && plan.path !== retired ? 'gate' : 'planner';
    },
    routeTransitions: { gate: { to: 'gate', onRefusal: 'planner' } },
    byStatus: { build: 'builder', verify: 'verifier' },
    dispatches: {
        planner: { agent: 'planner', message: (s) => `Plan ${s.subject}. Run: ${s.runPath}.${s.notes?.length ? ` Notes: ${JSON.stringify(s.notes)}.` : ''}` },
        builder: { agent: 'builder', message: (s) => `Build the plan ${s.plan}. Run: ${s.runPath}.` },
        verifier: { agent: 'verifier', message: (s) => `Verify the build against ${s.plan}. Run: ${s.runPath}.` },
    },
    results: {
        planner: { ok: { store: 'plan', from: 'plan' }, 'needs-decisions': { ask: 'questions' } },
        builder: { ok: { transition: 'verify' }, blocked: { park: true } },
        verifier: { pass: { verify: 'pass' }, fail: { verify: 'fail' }, 'plan-invalidated': { invalidate: true }, blocked: { park: true } },
    },
    stops: ['done'],
    limits: { redispatch: 2, unusable: 1, failed: { phase: 'build', at: 'build', max: 3, note: (s) => `3 failed verifications since the gate; latest report ${s.verifications?.build?.proof}` } },
});
