import type { HumanEdge, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';

/** A human edge of the run's current state; `resumes` marks a blocked run's way back into the state it blocked from. */
export type RunEdge = HumanEdge & { resumes?: true };

/**
 * The moves a human can make with `transition` now: the compiled human edges of the state, or for a blocked run
 * the resume edge into `blockedFrom` followed by the human edges of `blockedFrom`.
 */
export function humanEdges({ cfg }: Ctx, run: Run): RunEdge[] {
    if (run.status !== 'blocked') return (cfg.human[run.status] ?? []).map((e) => ({ ...e }));
    const from = run.blockedFrom;
    if (!from) return [];
    const edges: RunEdge[] = [{ to: from, resumes: true, ...(from === cfg.limits.failed?.at ? { resets: true as const } : {}) }];
    for (const e of cfg.human[from] ?? []) {
        const have = edges.find((x) => x.to === e.to);
        if (have) Object.assign(have, e);
        else edges.push({ ...e });
    }
    return edges;
}
