import type { Dispatch, Run } from '../../../config.mts';

/** The time of the latest human move: a gate decision, a human transition, or an answer. */
export const lastHumanAt = (run: Run): string =>
    [...run.history.filter((h) => h.human).map((h) => h.at), ...run.questions.flatMap((q) => q.resolvedAt ?? [])].sort().at(-1) ?? '';

/** The dispatches opened since the latest human move: `limits.opens` counts them, and a stop lists them. */
export const sinceHuman = (run: Run): Dispatch[] => {
    const at = lastHumanAt(run);
    return run.dispatches.filter((d) => d.openedAt >= at);
};
