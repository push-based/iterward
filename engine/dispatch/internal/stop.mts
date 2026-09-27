import type { Run } from '../../../config.mts';
import { type Ctx, frozenFiles } from '../../context.mts';
import { pendingQuestions } from '../../decisions/pending-questions.mts';
import { humanEdges, type RunEdge } from '../../run/human-edges.mts';

export type StopKind = 'questions' | 'gate' | 'blocked' | 'status';

/** Names joined with commas and a serial "and". */
const joined = (xs: string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}`);
const byTime = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** A human move into the initial state re-freezes the answered questions at their files' current bytes. */
const refreezes = ({ cfg }: Ctx, run: Run, to: string) => (to === cfg.initial && run.questions.some((q) => q.status === 'resolved') ? ', and re-freezes the answered questions' : '');

/** What a human transition along `e` does, as a stop words it. */
function effect(ctx: Ctx, run: Run, e: RunEdge): string {
    const verb = e.resumes ? 'resumes' : e.retries ? 'retries' : 'moves to';
    const drops = e.drops ? ` and drops the ${ctx.cfg.gates[e.drops].label} freeze on ${joined(frozenFiles(ctx, e.drops))}` : '';
    return `${verb} ${e.to}${drops}${refreezes(ctx, run, e.to)}${e.resets ? ', and the failed count resets' : ''}`;
}

/** The human's moves from the current state, as ready-to-show lines: the stop kind's own moves, then each human edge. */
function moves(ctx: Ctx, run: Run, kind: StopKind): string[] {
    const lines: string[] = [];
    if (kind === 'questions') {
        for (const q of pendingQuestions(run)) lines.push(`\`answer\` ${q.id} with an option key or \`custom\`, and the human's words: resolves ${q.id} and freezes ${q.file}.`);
    }
    if (kind === 'gate') {
        const g = ctx.cfg.gates[run.status];
        const files = frozenFiles(ctx, run.status);
        lines.push(`\`gate\` ${run.status} approved, with an optional note: ${files.length ? `freezes ${joined(files)} and moves` : 'moves'} to ${g.next}.`);
        lines.push(`\`gate\` ${run.status} rejected, with the human's note: records the note and moves back to ${g.back}${refreezes(ctx, run, g.back)}.`);
    }
    for (const e of humanEdges(ctx, run)) lines.push(`\`transition\` to ${e.to}, with the human's note: ${effect(ctx, run, e)}.`);
    return lines;
}

/** Every human move since the latest closed dispatch, as lines, in the order the run recorded them. */
function recorded({ cfg }: Ctx, run: Run): string[] {
    const since = run.dispatches.findLast((d) => d.closedAt)?.closedAt ?? '';
    const entries: [string, string][] = [
        ...run.questions.flatMap((q): [string, string][] => (q.resolvedAt && q.resolvedAt >= since ? [[q.resolvedAt, `answer ${q.id} ${q.chosen}: "${q.answer}"`]] : [])),
        ...Object.entries(run.gates).flatMap(([name, g]) => g.history.filter((h) => h.at >= since).map((h): [string, string] => [h.at, `gate ${name} ${h.decision}${h.note ? `: "${h.note}"` : ''}`])),
        // A human history entry from a gate is its decision, which the gate's own history words.
        ...run.history.filter((h) => h.human && !cfg.gates[h.from] && h.at >= since).map((h): [string, string] => [h.at, `transition ${h.from} → ${h.to}: "${h.note}"`]),
    ];
    return entries.sort(byTime).map(([, line]) => line);
}

/**
 * A stop for the human: the kind's own fields, the human's moves, the preflight warnings while the freezing gate
 * is not approved (always, in a loop with no freezing gate), the dispatches between the last two distinct stops, and the human moves since the latest closed
 * dispatch. Repeating the same stop repeats `since` and `recorded`.
 */
export function stop(ctx: Ctx, run: Run, kind: StopKind, fields: Record<string, unknown> = {}) {
    const { cfg } = ctx;
    const n = run.dispatches.length;
    const m = run.stopMark ?? { from: 0, to: 0 };
    if (m.to !== n) run.stopMark = { from: m.to, to: n };
    const { from, to } = run.stopMark ?? m;
    const since = run.dispatches.slice(from, to).map((d) => {
        const minutes = d.closedAt ? Math.round((Date.parse(d.closedAt) - Date.parse(d.openedAt)) / 6000) / 10 : undefined;
        const slow = minutes != null && cfg.limits.dispatchMinutes != null && minutes > cfg.limits.dispatchMinutes;
        return { id: d.id, name: d.name, agent: d.agent, attempt: d.attempt, outcome: d.outcome, ...(minutes != null ? { minutes } : {}), ...(slow ? { slow: true } : {}), ...(d.note ? { note: d.note.slice(0, 300) } : {}) };
    });
    const frozen = cfg.freezeGate != null && run.gates[cfg.freezeGate]?.decision === 'approved';
    return {
        do: 'stop',
        stop: kind,
        status: run.status,
        ...fields,
        moves: moves(ctx, run, kind),
        ...(!frozen && run.warnings.length ? { warnings: run.warnings } : {}),
        since,
        recorded: recorded(ctx, run),
    };
}
