import type { GuardContext, Run } from '../../../config.mts';
import { activeDecisionIds } from '../../decisions/active-decision-ids.mts';

/** What an artifact's or a gate's guard receives. */
export const guardCtx = (run: Run, runPath?: string): GuardContext => ({ run, runPath, root: process.cwd(), docs: run.docs ?? {}, active: activeDecisionIds(run) });
