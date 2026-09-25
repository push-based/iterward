import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { requireFreshProof } from '../run/internal/require-fresh-proof.mts';
import { hasText, now } from '../util.mts';
import { appendAttempt } from './internal/append-attempt.mts';

/** A human rejects a recorded pass before the next phase starts; the revoked attempt counts as failed. */
export function revokeVerification({ cfg }: Ctx, run: Run, phase: string, note: string | undefined, proof: unknown): Run {
    const rv = cfg.revoke;
    if (!rv) throw new Error('this loop has no revoke');
    if (phase !== rv.phase) throw new Error(`revoke covers the ${rv.phase} phase only, not ${phase}`);
    if (run.status !== rv.at) throw new Error(`revoke needs status ${rv.at}, not ${run.status}`);
    if (!hasText(note)) throw new Error('revoke needs a note stating why the pass is rejected');
    if (!hasText(proof)) throw new Error('revoke needs the review file as its proof');
    requireFreshProof(run, proof);
    appendAttempt(run, phase, { verdict: 'revoked', at: now(), proof: String(proof), note });
    run.history.push({ from: run.status, to: rv.to, at: now(), note: `${phase} pass revoked: ${note}` });
    run.status = rv.to;
    return run;
}
