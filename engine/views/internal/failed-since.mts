import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';

/** Verify attempts that failed or were revoked since the current approval of the freezing gate. */
export function failedSince({ freezeGate }: Ctx, run: Run, phase: string): number {
    const g = freezeGate ? run.gates[freezeGate] : undefined;
    const from = g?.decision === 'approved' ? g.attempts?.[phase] ?? 0 : 0;
    return (run.verifications?.[phase]?.attempts ?? []).slice(from).filter((t: any) => t.verdict === 'fail' || t.verdict === 'revoked').length;
}
