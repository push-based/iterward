import type { Run } from '../../../config.mts';

/** Ids of questions a redirect retired. */
export const retiredIds = (run: Run): Set<string> => new Set((run.redirects ?? []).flatMap((x) => x.retired));
