import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';

/**
 * The failed verdicts the `maxFailed` limit counts: the history entries from its verify stage to its work stage
 * that no human made, after the latest human move into the work stage. A gate approval into the work stage and
 * a human transition into it both reset the count.
 */
export function failedSince({ cfg }: Ctx, run: Run): number {
    const lim = cfg.limits.failed;
    if (!lim) return 0;
    const from = run.history.findLastIndex((h) => h.human && h.to === lim.at);
    return run.history.slice(from + 1).filter((h) => !h.human && h.from === lim.stage && h.to === lim.at).length;
}
