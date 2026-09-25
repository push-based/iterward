import { existsSync } from 'node:fs';

import type { RouteContext, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { pendingQuestions } from '../../decisions/pending-questions.mts';
import { draftPath } from './draft-path.mts';

/** What the loop's `route` receives. */
export const routeCtx = (ctx: Ctx, runPath: string, run: Run): RouteContext => {
    const d = draftPath(ctx, runPath);
    return { run, runPath, pending: pendingQuestions(run), draft: d && existsSync(d) ? d : null };
};
