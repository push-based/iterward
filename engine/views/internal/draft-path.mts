import { dirname, join } from 'node:path';

import type { Ctx } from '../../context.mts';

/** The loop's working file beside the run, or null when the loop has none. */
export const draftPath = ({ cfg }: Ctx, runPath: string) => (cfg.draft ? join(dirname(runPath), cfg.draft) : null);
