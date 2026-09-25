import type { Run } from '../../../config.mts';
import { citedProofs } from './cited-proofs.mts';

export function requireFreshProof(run: Run, proof: unknown) {
    if (citedProofs(run).has(String(proof))) throw new Error(`proof ${proof} is already cited by this run; each attempt writes its own report (never reuse or overwrite one)`);
}
