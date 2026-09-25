import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { transition } from '../run/transition.mts';
import { gateOf } from './internal/gate-of.mts';
import { gateReady } from './internal/gate-ready.mts';
import { recordGate } from './internal/record-gate.mts';

/**
 * Approve a gate: freezes its artifact and moves on. The preconditions are re-read at the freeze. The
 * approval records each phase's attempt count, so failures count from it in order, not by clock.
 */
export function approve(ctx: Ctx, run: Run, name: string, note?: string): Run {
    const g = gateOf(ctx, run, name);
    gateReady(ctx, run, name);
    recordGate(ctx, run, name, 'approved', note, { attempts: Object.fromEntries(Object.entries(run.verifications ?? {}).map(([k, v]) => [k, (v.attempts ?? []).length])) });
    return transition(ctx, run, g.next, `${name} approved`);
}
