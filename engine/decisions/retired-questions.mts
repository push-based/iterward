import type { Run } from '../../config.mts';

/** The questions the latest redirect retired, as stored. */
export function retiredQuestions(run: Run): any[] {
    const ids = new Set(run.redirects?.at(-1)?.retired ?? []);
    return (run.questions ?? []).filter((q) => ids.has(q.id));
}
