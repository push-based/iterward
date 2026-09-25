import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText, now } from '../util.mts';

/**
 * A fact breaks the approved artifact: the only path that re-opens it. Clears the gate's approval and
 * returns the run to the initial state; `reason`, `refs`, and the verifier's report are kept.
 */
export function invalidate({ cfg, frozen, freezeGate }: Ctx, run: Run, { reason, refs, proof }: { reason?: string; refs?: string[]; proof?: string } = {}): Run {
    const inv = cfg.invalidate;
    if (!inv) throw new Error('this loop has no invalidate');
    const from = run.status;
    const origin = from === 'blocked' ? run.blockedFrom : from;
    if (!inv.from.includes(origin as string)) throw new Error(`invalidate needs one of ${inv.from.join(', ')}, not ${from}${from === 'blocked' ? ` (blocked from ${origin})` : ''}`);
    if (!hasText(reason)) throw new Error('invalidate needs a reason');
    if (inv.proofFrom.includes(origin as string) && !hasText(proof)) throw new Error('an invalidation from a verify phase requires its proof report (--proof)');
    const retired = frozen ? run.artifacts[frozen] : undefined;
    // `seq` orders the invalidation among the stores, so routing can tell whether an artifact was stored since.
    (run.invalidations ??= []).push({ ...(retired ? { retired } : {}), reason, refs: refs ?? [], ...(proof ? { proof: String(proof) } : {}), at: now(), seq: run.seq ?? 0, from });
    if (freezeGate) run.gates[freezeGate] = { history: run.gates[freezeGate]?.history ?? [] };
    run.history.push({ from, to: inv.to, at: now(), note: `invalidated: ${reason}` });
    run.status = inv.to;
    delete run.blockedFrom;
    return run;
}
