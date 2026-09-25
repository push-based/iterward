import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText, now } from '../util.mts';
import { activeDecisionIds } from './active-decision-ids.mts';
import { optionKey } from './internal/option-key.mts';
import { pendingQuestions } from './pending-questions.mts';

/**
 * Store questions as pending and assign their ids (D1, D2, …). The whole list is checked first. `origin`
 * names the dispatch that asked, so routing can send the answers back to the agent that asked.
 */
export function askQuestions(ctx: Ctx, run: Run, questions: any[], origin?: { dispatch: number; agent: string }): any[] {
    const { cfg } = ctx;
    if (run.status !== cfg.initial) throw new Error(`ask is only allowed at status ${cfg.initial}, not ${run.status}`);
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('ask needs a non-empty questions[]');
    const active = activeDecisionIds(run);
    const pendingText = new Set(pendingQuestions(run).map((q) => q.question));
    const resolvedText = new Map((run.decisions ?? []).filter((d) => active.has(d.id)).map((d) => [d.question, d.id]));
    const checked = questions.map((q, i) => {
        const where = `question ${i + 1}`;
        if (!hasText(q?.question)) throw new Error(`${where}: needs the question text`);
        const keys = (q.options ?? []).map(optionKey);
        if (keys.length < 2 || keys.some((k: unknown) => !k) || new Set(keys).size !== keys.length) {
            throw new Error(`${where}: needs at least 2 options, each starting with its own capital-letter key ("A. …", "B. …")`);
        }
        if (!hasText(q.recommendation)) throw new Error(`${where}: needs a recommendation`);
        if (q.supersedes != null && !active.has(q.supersedes)) throw new Error(`${where}: supersedes ${q.supersedes}, which is not an active decision`);
        if (pendingText.has(q.question)) throw new Error(`${where}: the same question is already pending; answer it instead of asking it again`);
        if (resolvedText.has(q.question) && q.supersedes !== resolvedText.get(q.question)) throw new Error(`${where}: ${resolvedText.get(q.question)} already resolves this question; re-open it with supersedes: "${resolvedText.get(q.question)}"`);
        return { ...(q.topic ? { topic: String(q.topic) } : {}), question: q.question, options: q.options.map(String), recommendation: q.recommendation, ...(q.supersedes ? { supersedes: q.supersedes } : {}) };
    });
    const askedAt = now();
    let n = (run.questions ?? []).length;
    const stored = checked.map((q) => ({ id: `D${++n}`, ...q, askedAt, ...(origin ? { origin } : {}) }));
    (run.questions ??= []).push(...stored);
    return stored;
}
