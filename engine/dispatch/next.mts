import type { Dispatch, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { questionView } from '../decisions/question-view.mts';
import { transition } from '../run/transition.mts';
import { failedSince } from '../views/internal/failed-since.mts';
import { routeCtx } from '../views/internal/route-ctx.mts';
import { show } from '../views/show.mts';
import { summary } from '../views/summary.mts';
import { dispatchOut } from './internal/dispatch-out.mts';
import { open } from './internal/open.mts';
import { openDispatch } from './internal/open-dispatch.mts';
import { park } from './internal/park.mts';
import { stop } from './internal/stop.mts';
import { streak } from './internal/streak.mts';

// `next` and `refused` call each other, so they share this file.

/** The move the run needs now: an open dispatch, a new one, or a stop for the human. */
export function next(ctx: Ctx, runPath: string, run: Run): any {
    const { cfg, limits } = ctx;
    const o = openDispatch(run);
    if (o) return dispatchOut(o);
    const s = run.status;
    if (s === 'blocked') {
        const parked = run.history.findLast((h) => h.to === 'blocked');
        return stop(ctx, run, { stop: 'blocked', reason: parked?.note, ...(parked?.proof ? { proof: parked.proof } : {}), blockedFrom: run.blockedFrom });
    }
    if (s === cfg.initial) {
        const pending = pendingQuestions(run);
        if (pending.length) {
            const last = (run.dispatches ?? []).findLast((d) => d.closedAt);
            return stop(ctx, run, { stop: 'questions', questions: pending.map(questionView), gaps: last?.gaps ?? [] });
        }
        const route = cfg.route?.(routeCtx(ctx, runPath, run));
        const t = route ? cfg.routeTransitions?.[route] : undefined;
        if (t) {
            try {
                transition(ctx, run, t.to);
            } catch (e) {
                return refused(ctx, runPath, run, (e as Error).message, { name: t.onRefusal });
            }
            streak(run).refusals = 0;
            return next(ctx, runPath, run);
        }
        if (!route || !cfg.dispatches?.[route]) throw new Error(`the loop has no dispatch for route ${route}`);
        return open(ctx, runPath, run, route);
    }
    if (cfg.stops?.includes(s)) return stop(ctx, run, { stop: 'status', status: s });
    if (cfg.gates[s]) return stop(ctx, run, { stop: 'gate', gate: s, ...(cfg.gates[s].summary ? { summary: summary(ctx, runPath, run, s) } : {}) });
    const lim = limits.failed;
    if (lim && s === lim.at && failedSince(ctx, run, lim.phase) >= lim.max) {
        park(ctx, run, lim.note(show(ctx, runPath, run)));
        return next(ctx, runPath, run);
    }
    const d = cfg.byStatus?.[s];
    if (d) return open(ctx, runPath, run, d);
    return stop(ctx, run, { stop: 'status', status: s });
}

/** A refused action: re-dispatch with the refusal as Fixes, and park past the limit. */
export function refused(ctx: Ctx, runPath: string, run: Run, message: string, { name, source, limit }: { name?: string; source?: Dispatch; limit?: number }) {
    const st = streak(run);
    st.refusals += 1;
    if (st.refusals > (limit ?? ctx.limits.redispatch)) {
        st.refusals = 0;
        park(ctx, run, message);
        return next(ctx, runPath, run);
    }
    if (name) return open(ctx, runPath, run, name, { fixes: message, pass: source?.pass });
    return open(ctx, runPath, run, source!.name, { base: source!.base, fixes: message, pass: source!.pass, resume: source!.resume });
}
