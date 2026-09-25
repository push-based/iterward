import type { Run } from '../../config.mts';
import { retiredIds } from './internal/retired-ids.mts';

/** Questions that no decision answers and no redirect retired. */
export function pendingQuestions(run: Run): any[] {
    const closed = new Set([...(run.decisions ?? []).map((d) => d.id), ...retiredIds(run)]);
    return (run.questions ?? []).filter((q) => !closed.has(q.id));
}
