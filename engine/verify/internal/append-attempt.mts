import type { Run } from '../../../config.mts';

/** Record an attempt as the phase's latest verdict and append it to the phase's attempts. */
export function appendAttempt(run: Run, phase: string, rec: Record<string, unknown>) {
    const v = (run.verifications ??= {});
    v[phase] = { ...rec, attempts: [...(v[phase]?.attempts ?? []), rec] };
}
