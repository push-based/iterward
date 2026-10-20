import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Run } from '../../../config.ts';
import { type Ctx, frozenFiles, inRunDir } from '../../context.ts';
import { pendingQuestions } from '../../decisions/pending-questions.ts';
import { dropsOf } from '../../run/freezes.ts';
import { humanEdges } from '../../run/human-edges.ts';
import { fileSha256 } from '../../util.ts';
import { sinceHuman } from '../../views/internal/since-human.ts';

export type StopKind = 'questions' | 'gate' | 'blocked' | 'status';

/**
 * A move the human can make now: the call that records it, what the call takes, and what it changes besides the
 * status. `freezes` lists the files it freezes, and `drops` the gate whose freeze it drops with that gate's files.
 * Paths are as the run path names them.
 */
export type Move =
    | { call: 'answer'; id: string; freezes: string[] }
    | { call: 'gate'; gate: string; decision: 'approved' | 'rejected'; to: string; freezes?: string[]; drops?: { gate: string; files: string[] } }
    | { call: 'transition'; to: string; resumes?: true; drops?: { gate: string; files: string[] } };

/** A human move the run recorded. */
export type Recorded =
    | { call: 'answer'; id: string; chosen: string; answer: string; at: string }
    | { call: 'gate'; gate: string; decision: 'approved' | 'rejected'; note?: string; at: string }
    | { call: 'transition'; from: string; to: string; note: string; at: string };

/**
 * A gate stop's own fields: the gate, its label, the files its approval freezes, and after an earlier decision,
 * that decision with `changed`, the frozen files whose bytes differ from the ones the human judged then.
 */
export function gateFields(ctx: Ctx, runPath: string, run: Run, gate: string) {
    const inRun = (file: string) => join(dirname(runPath), file);
    const files = frozenFiles(ctx, gate);
    const last = run.gates[gate]?.history.at(-1);
    const changed = (file: string) => !existsSync(inRunDir(runPath, file)) || last!.judged[file] !== fileSha256(inRunDir(runPath, file));
    return {
        gate,
        label: ctx.cfg.gates[gate].label,
        freezes: files.map(inRun),
        ...(last ? { last: { decision: last.decision, at: last.at }, changed: files.filter(changed).map(inRun) } : {}),
    };
}

/** The human's moves now: an answer for each pending question, a gate's decisions, then each human move of the state. */
function moves(ctx: Ctx, runPath: string, run: Run, kind: StopKind): Move[] {
    const { cfg } = ctx;
    const inRun = (file: string) => join(dirname(runPath), file);
    const drops = (to: string) => {
        const g = dropsOf(ctx, run, to);
        return g ? { drops: { gate: g, files: frozenFiles(ctx, g).map(inRun) } } : {};
    };
    const list: Move[] = pendingQuestions(run).map((q) => ({ call: 'answer', id: q.id, freezes: [inRun(q.file)] }));
    if (kind === 'gate') {
        const g = cfg.gates[run.status];
        const files = frozenFiles(ctx, run.status).map(inRun);
        list.push({ call: 'gate', gate: run.status, decision: 'approved', to: g.approve, ...(files.length ? { freezes: files } : {}), ...drops(g.approve) });
        list.push({ call: 'gate', gate: run.status, decision: 'rejected', to: g.reject, ...drops(g.reject) });
    }
    for (const { drops: _, ...edge } of humanEdges(ctx, run)) list.push({ call: 'transition', ...edge, ...drops(edge.to) });
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
 * since the last human move, and the human moves since the latest closed dispatch. The orchestrator decides how
 * to word each field, and when to show it.
 */
export function stop(ctx: Ctx, runPath: string, run: Run, kind: StopKind, fields: Record<string, unknown> = {}) {
    const since = sinceHuman(run).map((d) => {
        const minutes = d.closedAt ? Math.round((Date.parse(d.closedAt) - Date.parse(d.openedAt)) / 6000) / 10 : undefined;
        return { id: d.id, name: d.name, agent: d.agent, attempt: d.attempt, outcome: d.outcome, ...(minutes != null ? { minutes } : {}), ...(d.fixes?.length ? { fixes: d.fixes.join('\n').slice(0, 300) } : {}) };
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
