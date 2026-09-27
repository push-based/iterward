import { existsSync, statSync } from 'node:fs';

import type { Run } from '../../config.mts';
import { type Ctx, hookCtx } from '../context.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { scanQuestions } from '../decisions/scan-questions.mts';
import { FreezeError } from '../run/freezes.mts';
import { transition } from '../run/transition.mts';
import { close } from './internal/close.mts';
import { open } from './internal/open.mts';
import { info, openDispatch } from './internal/open-dispatch.mts';
import { next, parked, refused } from './next.mts';

/**
 * Read the open dispatch's document and apply the action of its status. The document must be fresh: written
 * during the dispatch. The loop's result hook reads its status, which must be an outcome of the dispatch; any
 * other result is unusable and re-dispatched, and past `limits.unusable` in a row the run parks. Unless the
 * action parks, the artifact's guard runs, and its errors re-dispatch. At the initial state new question files
 * enter the ledger. Then the action: `transition`, `route`, `ask`, or `park`.
 */
export async function result(ctx: Ctx, runPath: string, run: Run): Promise<object> {
    const { cfg } = ctx;
    const d = openDispatch(run);
    if (!d) throw new Error('no open dispatch: run next first');
    const spec = cfg.dispatches[d.name];
    const dispatch = info(d);
    const ctxOf = () => ({ ...hookCtx(runPath, run), dispatch });
    let error: string | undefined;
    let status = '';
    if (!existsSync(dispatch.document) || statSync(dispatch.document).mtimeMs < Date.parse(d.openedAt)) error = `${d.agent} wrote no ${d.document} during this dispatch`;
    else {
        const r = await cfg.result(dispatch.document, ctxOf());
        if ('error' in r) error = r.error;
        else if (!Object.hasOwn(spec.outcomes, r.status)) error = `${d.agent} returned ${r.status}, which is not an outcome of ${d.name}: ${Object.keys(spec.outcomes).join(', ')}`;
        else status = r.status;
    }
    if (error !== undefined) {
        close(d, 'unusable', error);
        run.streak.unusable += 1;
        if (run.streak.unusable > cfg.limits.unusable) {
            const n = run.streak.unusable;
            run.streak.unusable = 0;
            return parked(ctx, runPath, run, `${d.agent} returned no usable result ${n} times in a row: ${error}`);
        }
        return open(ctx, runPath, run, d.name, { ...(d.with ? { with: d.with } : {}), fixes: [error] });
    }
    run.streak.unusable = 0;
    const action = spec.outcomes[status];
    const source = { name: d.name, ...(d.with ? { with: d.with } : {}) };
    const refuse = (lines: string[]) => {
        close(d, status, `refused: ${lines.join('\n')}`);
        return refused(ctx, runPath, run, lines, source);
    };
    if (!('park' in action)) {
        const guard = cfg.artifacts[spec.artifact].guard;
        const errors = guard ? await guard(dispatch.document, { ...ctxOf(), event: 'result', status }) : [];
        if (errors.length) return refuse(errors);
    }
    scanQuestions(ctx, runPath, run);
    if ('transition' in action) {
        try {
            await transition(ctx, runPath, run, action.transition, { via: 'action', dispatch });
        } catch (e) {
            if (!(e instanceof FreezeError)) return refuse((e as Error).message.split('\n'));
            close(d, status);
            return parked(ctx, runPath, run, e.message);
        }
    }
    if ('ask' in action && !pendingQuestions(run).length) return refuse([`${d.agent} returned ${status} and no question file is pending`]);
    run.streak.refusals = 0;
    close(d, status);
    if ('park' in action) return parked(ctx, runPath, run, `${d.agent} returned ${status}; the reason is in ${d.document}.`);
    return next(ctx, runPath, run);
}
