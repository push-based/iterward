import type { Question, Run } from '../../config.ts';

/** The questions the human hasn't answered, in the order the ledger took them. */
export const pendingQuestions = (run: Run): Question[] => run.questions.filter((q) => q.status === 'pending');
