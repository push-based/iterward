import { dirname, join } from 'node:path';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { sinceHuman } from '../views/internal/since-human.mts';
import { dispatchOut } from './internal/dispatch-out.mts';
import { listed, open } from './internal/open.mts';
import { openDispatch } from './internal/open-dispatch.mts';
import { park } from './internal/park.mts';
import { gateFields, stop } from './internal/stop.mts';

/**
 * The move the run needs now: the open dispatch, a stop for the human (blocked, a gate, a stop, or pending
 * questions before any step), or the status step opened. A step opened `limits.opens` times since the last human
 * move parks the run instead.
 */
export async function next(ctx: Ctx, runPath: string, run: Run): Promise<object> {
    const { cfg } = ctx;
    const o = openDispatch(run);
    if (o) return dispatchOut(o);
    const s = run.status;
    if (s === 'blocked') return stop(ctx, runPath, run, 'blocked', { blockedFrom: run.blockedFrom, reason: run.history.findLast((h) => h.to === 'blocked')?.note });
    if (cfg.gates[s]) return stop(ctx, runPath, run, 'gate', gateFields(ctx, runPath, run, s));
    if (!cfg.steps[s]) return stop(ctx, runPath, run, 'status');
    const pending = pendingQuestions(run);
    if (pending.length) return stop(ctx, runPath, run, 'questions', { questions: pending.map((q) => ({ id: q.id, file: join(dirname(runPath), q.file) })) });
    const mine = sinceHuman(run).filter((d) => d.name === s);
    if (mine.length >= cfg.limits.opens) {
        const last = mine.at(-1)!;
        const lead = `${s} opened ${mine.length} times since the last human move, and the loop allows ${cfg.limits.opens}; the latest ${s} dispatch ended ${last.outcome} with ${last.document}`;
        return parked(ctx, runPath, run, last.fixes?.length ? listed(runPath, `${s}-opens`, last.fixes, `${lead}, and these lines to fix:`) : `${lead}.`);
    }
    return open(ctx, runPath, run, s);
}

/** Park the run with `note`, and return the blocked stop. */
export async function parked(ctx: Ctx, runPath: string, run: Run, note: string) {
    await park(ctx, runPath, run, note);
    return next(ctx, runPath, run);
}
