import type { Question, Run } from '../../config.ts';
import { type Ctx, hookCtx, inRunDir } from '../context.ts';
import { freeze } from '../run/freezes.ts';
import { hasText, now } from '../util.ts';

/**
 * Record the human's answers, all or none: each entry names a pending question, an option key or `custom`, and
 * the human's words. Every entry is checked first, and a problem in any entry refuses the call with every problem.
 * Then, for each entry in order, the loop's `onAnswer` writes it into the question file, the file freezes, and the
 * question resolves. A throw restores the run's questions and freezes, so the call records no answer, and names the
 * entry. The engine doesn't undo what `onAnswer` wrote for the entries before it.
 */
export async function answerQuestions(ctx: Ctx, runPath: string, run: Run, answers: { id?: string; option?: string; answer?: string }[]): Promise<Question[]> {
    const { cfg } = ctx;
    const problems = answers.flatMap(({ id, option, answer }, i) => {
        const q = run.questions.find((x) => x.id === id);
        return [
            ...(!hasText(id) ? ['needs a question id'] : !q ? [`isn't in the ledger, which holds ${run.questions.map((x) => x.id).join(', ') || 'no question'}`] : []),
            ...(q && q.status !== 'pending' ? ['is resolved already'] : []),
            ...(hasText(option) ? [] : ['needs an option key, or custom']),
            ...(hasText(answer) ? [] : ["needs the human's words as its answer, verbatim"]),
            ...(hasText(id) && answers.findIndex((x) => x.id === id) < i ? ['appears more than once'] : []),
        ].map((line) => `${hasText(id) ? id : `answer ${i + 1}`}: ${line}`);
    });
    if (problems.length) throw new Error([...new Set(problems)].join('\n'));
    const saved = structuredClone({ questions: run.questions, freezes: run.freezes });
    const resolved: Question[] = [];
    for (const { id, option, answer } of answers as { id: string; option: string; answer: string }[]) {
        const q = run.questions.find((x) => x.id === id)!;
        try {
            await cfg.onAnswer?.({ ...hookCtx(runPath, run), question: { id, file: inRunDir(runPath, q.file) }, option, answer });
            freeze(runPath, run, q.file, id);
        } catch (e) {
            Object.assign(run, saved);
            throw new Error(`${(e as Error).message}\nthe answer to ${id} was refused, so none of this call's answers was recorded`);
        }
        resolved.push(Object.assign(q, { status: 'resolved' as const, chosen: option, answer, resolvedAt: now() }));
    }
    return resolved;
}
