import type { Run } from '../../config.mts';

/** Ids of decisions no later decision supersedes. */
export function activeDecisionIds(run: Run): Set<string> {
    const superseded = new Set((run.decisions ?? []).map((d) => d.supersedes).filter(Boolean));
    return new Set((run.decisions ?? []).map((d) => d.id).filter((id) => !superseded.has(id)));
}
