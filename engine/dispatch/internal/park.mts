import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { transition } from '../../run/transition.mts';

/** Move the run to blocked for a human, with the note that explains why. */
export const park = (ctx: Ctx, runPath: string, run: Run, note: string) => transition(ctx, runPath, run, 'blocked', { via: 'action', note });
