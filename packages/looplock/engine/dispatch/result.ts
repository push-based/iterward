import { existsSync, statSync } from 'node:fs';

import type { Dispatch, Run } from '../../config.ts';
import { type Ctx, hookCtx } from '../context.ts';
import { pendingQuestions } from '../decisions/pending-questions.ts';
import { scanQuestions } from '../decisions/scan-questions.ts';
import { FreezeError } from '../run/freezes.ts';
import { transition } from '../run/transition.ts';
import { errorsOf, hasText, isObj, messageOf } from '../util.ts';
import { close } from './internal/close.ts';
import { info, openDispatch } from './internal/open-dispatch.ts';
import { next, parked } from './next.ts';

/**
 * How far a document's mtime can fall before `openedAt` and still count as written during the dispatch. Linux
 * stamps files from a coarse kernel clock that runs up to one scheduler tick (1 to 10 ms) behind `Date`.
 */
// ponytail: a fixed allowance; a document written in the 50 ms before the dispatch opened counts as fresh.
const CLOCK_GAP_MS = 50;
/**
 * How far a filesystem that stores whole seconds, such as HFS+ or FAT (2 seconds), rounds an mtime down. A
 * whole-second mtime reads as one of those.
 */
// ponytail: on such a filesystem, a document written in the 2 seconds before the dispatch opened counts as fresh.
const COARSE_MTIME_MS = 2000;

/**
 * Close the open dispatch and follow the machine. With `id`, the open dispatch must be that one, checked before
 * any hook runs. The document must be fresh: written during the dispatch. Its artifact's guard returns the status,
 * which must be an outcome of the step, or the errors that refuse it. New question files enter the ledger. Then
 * the outcome's target: `park`, `{ask}` (refused when no question is pending), or a transition. Every failure
 * closes the dispatch with the lines to fix, and `next` opens the same step again, until `limits.opens` parks the
 * run. Returns `closed`, the dispatch with the outcome it closed with, and the next move.
 */
export async function result(ctx: Ctx, runPath: string, run: Run, id?: number): Promise<object> {
    const d = openDispatch(run);
    // No `: ` in the line, because a refusal's lines are grouped by the text before it.
    if (id !== undefined && d?.id !== id) throw new Error(`dispatch ${id} isn't open (${d ? `dispatch ${d.id} is` : 'no open dispatch'})`);
    if (!d) throw new Error('no open dispatch: run next first');
    const move = await follow(ctx, runPath, run, d);
    return { closed: { id: d.id, step: d.name, outcome: d.outcome }, ...move };
}

/** Close `d` with its outcome and return the next move. */
async function follow(ctx: Ctx, runPath: string, run: Run, d: Dispatch): Promise<object> {
    const { cfg } = ctx;
    const step = cfg.steps[d.name];
    const dispatch = info(d);
    const failed = (outcome: string, fixes: string[]) => {
        close(d, outcome, fixes);
        return next(ctx, runPath, run);
    };
    const mtime = existsSync(dispatch.document) ? statSync(dispatch.document).mtimeMs : -Infinity;
    if (mtime + (mtime % 1000 ? 0 : COARSE_MTIME_MS) < Date.parse(d.openedAt) - CLOCK_GAP_MS) return failed('unusable', [`${d.agent} wrote no ${d.document} during this dispatch`]);
    const r = await cfg.artifacts[step.writes].guard!(dispatch.document, { ...hookCtx(runPath, run), event: 'result', dispatch });
    const errors = errorsOf(r);
    if (errors.length) return failed('refused', errors);
    const status = isObj(r) && 'status' in r ? r.status : undefined;
    if (!hasText(status)) return failed('unusable', [`${d.document}: the guard returned neither a status nor errors`]);
    const target = Object.hasOwn(step.outcomes, status) ? step.outcomes[status] : undefined;
    if (!target) return failed('unusable', [`${d.agent} returned ${status}, which is not an outcome of ${d.name}: ${Object.keys(step.outcomes).join(', ')}`]);
    scanQuestions(ctx, runPath, run);
    if (target === 'park') {
        close(d, status);
        return parked(ctx, runPath, run, `${d.agent} returned ${status}; the reason is in ${d.document}.`);
    }
    if (typeof target === 'object' && !pendingQuestions(run).length) return failed(status, [`${d.agent} returned ${status}, and no question file is pending`]);
    try {
        await transition(ctx, runPath, run, typeof target === 'object' ? target.ask : target, { via: 'machine', dispatch });
    } catch (e) {
        if (!(e instanceof FreezeError)) return failed(status, messageOf(e).split('\n'));
        close(d, status);
        return parked(ctx, runPath, run, e.message);
    }
    close(d, status);
    return next(ctx, runPath, run);
}
