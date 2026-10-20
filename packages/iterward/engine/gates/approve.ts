import type { Run } from '../../config.ts';
import { type Ctx, frozenFiles } from '../context.ts';
import { checkFreezes, freeze } from '../run/freezes.ts';
import { transition } from '../run/transition.ts';
import { gateOf } from './internal/gate-of.ts';
import { gateReady } from './internal/gate-ready.ts';
import { recordGate } from './internal/record-gate.ts';

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
