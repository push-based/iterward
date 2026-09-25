import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText, now } from '../util.mts';
import { activeDecisionIds } from './active-decision-ids.mts';
import { optionKey } from './internal/option-key.mts';
import { retiredIds } from './internal/retired-ids.mts';

/** Record one human resolution: an option key of the stored snapshot, or the human's own text. */
export function answerQuestion(ctx: Ctx, run: Run, { id, option, custom, answer }: { id: string; option?: string; custom?: string; answer?: string }): any {
    const { cfg } = ctx;
    if (run.status !== cfg.initial) throw new Error(`answer is only allowed at status ${cfg.initial}, not ${run.status}`);
    const q = (run.questions ?? []).find((x) => x.id === id);
    if (!q) throw new Error(`no question ${id}; ask stores a question before it can be answered`);
    if ((run.decisions ?? []).some((d) => d.id === id)) throw new Error(`${id} is already answered; a new question with supersedes re-opens it`);
    if (retiredIds(run).has(id)) throw new Error(`${id} was retired by a redirect; the revision asks it again under a new id when it still applies`);
    if ((option == null) === (custom == null)) throw new Error('answer takes exactly one of --option <KEY> or --custom "<TEXT>"');
    if (!hasText(answer)) throw new Error('answer needs --answer with the human\'s words, verbatim');
    let chosenText;
    if (option != null) {
        chosenText = q.options.find((o: string) => optionKey(o) === option);
        if (!chosenText) throw new Error(`${option} is not an option of ${id} (${q.options.map(optionKey).join(', ')})`);
    } else {
        if (!hasText(custom)) throw new Error('--custom needs the human\'s resolution text');
        chosenText = custom;
    }
    if (q.supersedes && !activeDecisionIds(run).has(q.supersedes)) throw new Error(`${id} supersedes ${q.supersedes}, which is no longer active`);
    // `seq` places the answer among the stores, so routing can tell whether an artifact was stored since.
    const decision = { id, ...(q.topic ? { topic: q.topic } : {}), question: q.question, options: q.options, recommendation: q.recommendation, answer, chosen: option ?? 'custom', chosenText, ...(q.supersedes ? { supersedes: q.supersedes } : {}), ...(q.origin ? { origin: q.origin } : {}), seq: run.seq ?? 0, at: now() };
    (run.decisions ??= []).push(decision);
    return decision;
}
