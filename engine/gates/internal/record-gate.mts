import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { now } from '../../util.mts';

/** Record a gate decision and append it, with the artifact it judged, to the gate's history. */
export function recordGate({ cfg }: Ctx, run: Run, name: string, decision: string, note?: string, extra: Record<string, unknown> = {}) {
    const g = cfg.gates[name];
    const at = now();
    const judged = g.freezes ? run.artifacts[g.freezes] : undefined;
    const history = [...(run.gates[name]?.history ?? []), { ...(judged ? { judged } : {}), decision, ...(note ? { note } : {}), ...extra, at }];
    run.gates[name] = { decision, answeredAt: at, ...(note ? { note } : {}), ...extra, history };
}
