import { dirname, join } from 'node:path';

import type { Run } from '../../config.mts';
import { type Ctx, frozenFiles, hookCtx } from '../context.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { FreezeError } from '../run/freezes.mts';
import { transition } from '../run/transition.mts';
import { failedSince } from '../views/internal/failed-since.mts';
import { planMove } from '../views/internal/plan-move.mts';
import { dispatchOut } from './internal/dispatch-out.mts';
import { listed, open } from './internal/open.mts';
import { openDispatch } from './internal/open-dispatch.mts';
import { park } from './internal/park.mts';
import { stop } from './internal/stop.mts';

// `next` and `refused` call each other, so they share this file.

/** The move the run needs now: the open dispatch, a new one, or a stop for the human. */
export async function next(ctx: Ctx, runPath: string, run: Run): Promise<object> {
    const { cfg } = ctx;
    const o = openDispatch(run);
    if (o) return dispatchOut(o);
    const s = run.status;
    const inRun = (file: string) => join(dirname(runPath), file);
    if (s === 'blocked') return stop(ctx, run, 'blocked', { blockedFrom: run.blockedFrom, reason: run.history.findLast((h) => h.to === 'blocked')?.note });
    if (s === cfg.initial) {
        const pending = pendingQuestions(run);
        if (pending.length) return stop(ctx, run, 'questions', { questions: pending.map((q) => ({ id: q.id, file: inRun(q.file) })) });
        const move = await planMove(ctx, runPath, run);
        if ('dispatch' in move) return open(ctx, runPath, run, move.dispatch, move.with ? { with: move.with } : {});
        try {
            await transition(ctx, runPath, run, move.gate, { via: 'route' });
        } catch (e) {
            if (e instanceof FreezeError) return parked(ctx, runPath, run, e.message);
            return refused(ctx, runPath, run, (e as Error).message.split('\n'), { name: move.onRefusal });
        }
        run.streak.refusals = 0;
        return next(ctx, runPath, run);
    }
    const g = cfg.gates[s];
    if (g) {
        const summary = g.summary ? { summary: await g.summary({ ...hookCtx(runPath, run), gate: s }) } : {};
        return stop(ctx, run, 'gate', { gate: s, label: g.label, freezes: frozenFiles(ctx, s).map(inRun), ...summary });
    }
    if (cfg.stops.includes(s)) return stop(ctx, run, 'status');
    const lim = cfg.limits.failed;
    if (lim && s === lim.at && failedSince(ctx, run) >= lim.max) {
        const report = run.dispatches.findLast((d) => d.name === cfg.byStatus[lim.stage])?.document ?? 'none';
        return parked(ctx, runPath, run, `${lim.max} failed ${lim.stage} verdicts since the last human move into ${lim.at}; the latest report is ${report}.`);
    }
    const d = cfg.byStatus[s];
    if (d) return open(ctx, runPath, run, d);
    return stop(ctx, run, 'status');
}

/** Park the run with `note`, and return the blocked stop. */
export async function parked(ctx: Ctx, runPath: string, run: Run, note: string) {
    await park(ctx, runPath, run, note);
    return next(ctx, runPath, run);
}

/** A refused move: re-dispatch `name` with the error lines as its Fixes, and park past `limits.redispatch` refusals in a row. */
export async function refused(ctx: Ctx, runPath: string, run: Run, lines: string[], source: { name: string; with?: Record<string, string> }) {
    run.streak.refusals += 1;
    if (run.streak.refusals > ctx.cfg.limits.redispatch) {
        const n = run.streak.refusals;
        run.streak.refusals = 0;
        return parked(ctx, runPath, run, listed(runPath, `${source.name}-refusal`, lines, `${source.name} was refused ${n} times in a row; the latest refusal:`));
    }
    return open(ctx, runPath, run, source.name, { ...(source.with ? { with: source.with } : {}), fixes: lines });
}
