import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { pendingQuestions } from '../../decisions/pending-questions.mts';
import { projectionErrors } from '../../decisions/projection-errors.mts';
import { guardCtx } from '../../run/internal/guard-ctx.mts';

/** Refuse entry to a freezing gate unless its artifact, its required artifacts, the ledger, and its guard are ready. */
export function gateReady(ctx: Ctx, run: Run, name: string) {
    const g = ctx.cfg.gates[name];
    if (!g.freezes) return;
    const doc = run.docs?.[g.freezes];
    if (doc == null) throw new Error(`${g.label} needs a ${g.freezes} (store ${g.freezes})`);
    for (const r of g.requires ?? []) if (!run.artifacts[r]) throw new Error(`${g.label} needs the ${r} (store ${r})`);
    const pending = pendingQuestions(run);
    if (pending.length) throw new Error(`${g.label} needs every question answered; pending: ${pending.map((q) => q.id).join(', ')}`);
    const errs = [...projectionErrors(ctx, run, doc), ...(g.guard?.(doc, guardCtx(run)) ?? [])];
    if (errs.length) throw new Error(`${g.label} refuses the ${g.freezes}: ${errs.join('; ')}`);
}
