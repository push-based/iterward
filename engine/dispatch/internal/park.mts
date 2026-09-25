import { existsSync } from 'node:fs';

import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { citedProofs } from '../../run/internal/cited-proofs.mts';
import { transition } from '../../run/transition.mts';

/** Move the run to blocked for a human, citing `proof` only when it exists and the run doesn't cite it yet. */
export function park(ctx: Ctx, run: Run, note: string, proof?: string) {
    transition(ctx, run, 'blocked', note, proof && existsSync(proof) && !citedProofs(run).has(proof) ? proof : undefined);
}
