import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { openDispatch } from '../dispatch/internal/open-dispatch.mts';
import { failedSince } from './internal/failed-since.mts';

/** The run's state, and nothing a document holds: the orchestrator reads documents itself. */
export function show(ctx: Ctx, run: Run) {
    const o = openDispatch(run);
    return {
        status: run.status,
        blockedFrom: run.blockedFrom ?? null,
        inputs: run.inputs,
        gates: Object.fromEntries(Object.entries(run.gates).filter(([, g]) => g.decision).map(([k, g]) => [k, { decision: g.decision, note: g.note ?? null, at: g.at }])),
        questions: run.questions.map((q) => ({ id: q.id, status: q.status, ...(q.chosen ? { chosen: q.chosen } : {}) })),
        freezes: Object.fromEntries(Object.entries(run.freezes).map(([file, f]) => [file, f.by])),
        warnings: run.warnings,
        failed: failedSince(ctx, run),
        dispatches: run.dispatches.length,
        open: o ? { id: o.id, agent: o.agent, document: o.document } : null,
    };
}
