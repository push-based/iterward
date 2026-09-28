import { dirname, join } from 'node:path';

import type { Run } from '../../../config.mts';
import { type Ctx, frozenFiles } from '../../context.mts';
import { pendingQuestions } from '../../decisions/pending-questions.mts';
import { humanEdges } from '../../run/human-edges.mts';

export type StopKind = 'questions' | 'gate' | 'blocked' | 'status';

/**
 * A move the human can make now: the call that records it, what the call takes, and what it changes besides the
 * status. `freezes` lists the files it freezes, `drops` the gate whose freeze it drops with that gate's files, and
 * `refreezes` the answered question files it freezes again at their current bytes. Paths are as the run path names them.
 */
export type Move =
    | { call: 'answer'; id: string; freezes: string[] }
    | { call: 'gate'; gate: string; decision: 'approved' | 'rejected'; to: string; freezes?: string[]; refreezes?: string[] }
    | { call: 'transition'; to: string; resumes?: true; retries?: true; resets?: true; drops?: { gate: string; files: string[] }; refreezes?: string[] };

/** A human move the run recorded. */
export type Recorded =
    | { call: 'answer'; id: string; chosen: string; answer: string; at: string }
    | { call: 'gate'; gate: string; decision: 'approved' | 'rejected'; note?: string; at: string }
    | { call: 'transition'; from: string; to: string; note: string; at: string };

/** The human's moves from the current state: the stop kind's own moves, then each human edge. */
function moves(ctx: Ctx, runPath: string, run: Run, kind: StopKind): Move[] {
    const { cfg } = ctx;
    const inRun = (file: string) => join(dirname(runPath), file);
    // A human move into the initial state re-freezes the answered questions.
    const refreezes = (to: string) => {
        const files = to === cfg.initial ? run.questions.filter((q) => q.status === 'resolved').map((q) => inRun(q.file)) : [];
        return files.length ? { refreezes: files } : {};
    };
    const list: Move[] = [];
    if (kind === 'questions') for (const q of pendingQuestions(run)) list.push({ call: 'answer', id: q.id, freezes: [inRun(q.file)] });
    if (kind === 'gate') {
        const g = cfg.gates[run.status];
        const files = frozenFiles(ctx, run.status).map(inRun);
        list.push({ call: 'gate', gate: run.status, decision: 'approved', to: g.next, ...(files.length ? { freezes: files } : {}) });
        list.push({ call: 'gate', gate: run.status, decision: 'rejected', to: g.back, ...refreezes(g.back) });
    }
    for (const { drops, ...edge } of humanEdges(ctx, run)) {
        list.push({ call: 'transition', ...edge, ...(drops ? { drops: { gate: drops, files: frozenFiles(ctx, drops).map(inRun) } } : {}), ...refreezes(edge.to) });
    }
    return list;
}

/** Every human move since the latest closed dispatch, in the order the run recorded them. */
function recorded({ cfg }: Ctx, run: Run): Recorded[] {
    const since = run.dispatches.findLast((d) => d.closedAt)?.closedAt ?? '';
    const entries: Recorded[] = [
        ...run.questions.flatMap((q): Recorded[] => (q.resolvedAt && q.resolvedAt >= since ? [{ call: 'answer', id: q.id, chosen: q.chosen!, answer: q.answer!, at: q.resolvedAt }] : [])),
        ...Object.entries(run.gates).flatMap(([gate, g]) => g.history.filter((h) => h.at >= since).map((h): Recorded => ({ call: 'gate', gate, decision: h.decision, ...(h.note ? { note: h.note } : {}), at: h.at }))),
        // A human history entry from a gate is its decision, which the gate's own history records.
        ...run.history.filter((h) => h.human && !cfg.gates[h.from] && h.at >= since).map((h): Recorded => ({ call: 'transition', from: h.from, to: h.to, note: h.note!, at: h.at })),
    ];
    return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * A stop for the human, as data: the kind's own fields, the human's moves, the preflight warnings, the dispatches
 * between the last two distinct stops, and the human moves since the latest closed dispatch. Repeating the same
 * stop repeats `since` and `recorded`. The orchestrator decides how to word each field, and when to show it.
 */
export function stop(ctx: Ctx, runPath: string, run: Run, kind: StopKind, fields: Record<string, unknown> = {}) {
    const n = run.dispatches.length;
    const m = run.stopMark ?? { from: 0, to: 0 };
    if (m.to !== n) run.stopMark = { from: m.to, to: n };
    const { from, to } = run.stopMark ?? m;
    const since = run.dispatches.slice(from, to).map((d) => {
        const minutes = d.closedAt ? Math.round((Date.parse(d.closedAt) - Date.parse(d.openedAt)) / 6000) / 10 : undefined;
        return { id: d.id, name: d.name, agent: d.agent, attempt: d.attempt, outcome: d.outcome, ...(minutes != null ? { minutes } : {}), ...(d.note ? { note: d.note.slice(0, 300) } : {}) };
    });
    return {
        do: 'stop',
        stop: kind,
        status: run.status,
        ...fields,
        moves: moves(ctx, runPath, run, kind),
        warnings: run.warnings,
        since,
        recorded: recorded(ctx, run),
    };
}
