import type { Doc, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { activeDecisionIds } from './active-decision-ids.mts';

/** How an artifact projects the ledger: each active decision named with at least one pointer, no unknown or superseded id. */
export function projectionErrors(ctx: Ctx, run: Run, doc: Doc): string[] {
    const { frozen, decisionsField: field } = ctx;
    if (doc == null) return [`the run has no ${frozen ?? 'artifact'}`];
    const errs = [];
    const applied: any[] = Array.isArray(doc[field]) ? doc[field] : [];
    const recorded = new Set((run.decisions ?? []).map((d) => d.id));
    const active = activeDecisionIds(run);
    for (const a of applied) {
        if (!recorded.has(a?.id)) errs.push(`${field} names ${a?.id}, which is not a recorded decision`);
        else if (!active.has(a.id)) errs.push(`${field} names ${a.id}, which a later decision superseded`);
    }
    for (const id of active) {
        if (!applied.some((a) => a?.id === id && Array.isArray(a.pointers) && a.pointers.length > 0)) errs.push(`active decision ${id} is not projected (${field} needs at least one pointer for it)`);
    }
    return errs;
}
