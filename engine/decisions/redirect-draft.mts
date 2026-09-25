import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText, now } from '../util.mts';
import { pendingQuestions } from './pending-questions.mts';

/** The artifact store counts now, so routing can tell whether anything was stored since. */
const storeCounts = (run: Run) => Object.fromEntries(Object.entries(run.artifacts).map(([k, r]) => [k, r.n]));

/** At a question stop the human redirects the draft instead of answering: every pending question retires. */
export function redirectDraft(ctx: Ctx, run: Run, note: string): any {
    const { cfg } = ctx;
    if (run.status !== cfg.initial) throw new Error(`redirect is only allowed at status ${cfg.initial}, not ${run.status}; at a gate a rejection carries the note`);
    if (!hasText(note)) throw new Error('redirect needs --note with the human\'s words, verbatim');
    const retired = pendingQuestions(run).map((q) => q.id);
    if (!retired.length) throw new Error('redirect needs pending questions: it redirects the draft at a question stop');
    const rec = { note, retired, refs: storeCounts(run), at: now() };
    (run.redirects ??= []).push(rec);
    return rec;
}
