import type { Run } from '../../../config.ts';
import type { Ctx } from '../../context.ts';
import { transition } from '../../run/transition.ts';

/** Move the run to blocked for a human, with the note that explains why. */
export const park = (ctx: Ctx, runPath: string, run: Run, note: string) => transition(ctx, runPath, run, 'blocked', { via: 'machine', note });
