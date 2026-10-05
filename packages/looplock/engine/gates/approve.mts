import type { Run } from '../../config.mts';
import { type Ctx, frozenFiles } from '../context.mts';
import { checkFreezes, freeze } from '../run/freezes.mts';
import { transition } from '../run/transition.mts';
import { gateOf } from './internal/gate-of.mts';
import { gateReady } from './internal/gate-ready.mts';
import { recordGate } from './internal/record-gate.mts';

/**
 * Approve a gate: its frozen artifacts' guards run with `approve`, the decision records the hash of each file
 * the human judged, the gate freezes those files, and the run moves to the machine's `<gate>.approve`.
 */
export async function approve(ctx: Ctx, runPath: string, run: Run, name: string, note?: string): Promise<Run> {
    const g = gateOf(ctx, run, name);
    await gateReady(ctx, runPath, run, name, 'approve');
    checkFreezes(ctx, runPath, run);
    recordGate(ctx, runPath, run, name, 'approved', note);
    for (const file of frozenFiles(ctx, name)) freeze(runPath, run, file, name);
    return transition(ctx, runPath, run, g.approve, { via: 'gate', note });
}
