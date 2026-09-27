import type { Question, Run } from '../../config.mts';
import { type Ctx, hookCtx, inRunDir } from '../context.mts';
import { freeze } from '../run/freezes.mts';
import { hasText, now } from '../util.mts';

/**
 * Record the human's answer to a pending question: `option` is an option key or `custom`, and `answer` the
 * human's words. The loop's `onAnswer` writes them into the question file first; a throw refuses the answer and
 * records nothing. Then the question resolves and its file freezes, by the question's id.
 */
export async function answerQuestion(ctx: Ctx, runPath: string, run: Run, { id, option, answer }: { id: string; option?: string; answer?: string }): Promise<Question> {
    const { cfg } = ctx;
    if (run.status !== cfg.initial) throw new Error(`answer is only allowed at status ${cfg.initial}, not ${run.status}`);
    const q = run.questions.find((x) => x.id === id);
    if (!q) throw new Error(`no question ${id}; the ledger holds ${run.questions.map((x) => x.id).join(', ') || 'none'}`);
    if (q.status !== 'pending') throw new Error(`${id} is resolved already; a new question with supersedes replaces it`);
    if (!hasText(option)) throw new Error('answer needs --option with an option key or custom');
    if (!hasText(answer)) throw new Error('answer needs --answer with the human\'s words, verbatim');
    await cfg.onAnswer?.({ ...hookCtx(runPath, run), question: { id, file: inRunDir(runPath, q.file) }, option, answer });
    freeze(runPath, run, q.file, id);
    Object.assign(q, { status: 'resolved', chosen: option, answer, resolvedAt: now() });
    return q;
}
