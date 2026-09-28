import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { dropsOf } from './freezes.mts';

/** A move a human can make with `transition`: `resumes` marks a blocked run's way back into the step it parked from, `drops` the gate whose freeze the move drops. */
export interface RunEdge { to: string; resumes?: true; drops?: string }

/**
 * The moves a human can make with `transition` now: the loop's human moves of the state, or for a blocked run
 * the resume into `blockedFrom` followed by the human moves of `blockedFrom`.
 */
export function humanEdges(ctx: Ctx, run: Run): RunEdge[] {
    const blocked = run.status === 'blocked';
    const at = blocked ? run.blockedFrom : run.status;
    if (!at) return [];
    const tos = [...new Set([...(blocked ? [at] : []), ...(ctx.cfg.human[at] ?? [])])];
    return tos.map((to) => {
        const drops = dropsOf(ctx, run, to);
        return { to, ...(blocked && to === at ? { resumes: true as const } : {}), ...(drops ? { drops } : {}) };
    });
}
