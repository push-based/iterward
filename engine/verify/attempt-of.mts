import type { Run } from '../../config.mts';

/** The number of the next attempt of a verify phase. */
export const attemptOf = (run: Run, phase: string) => (run.verifications?.[phase]?.attempts ?? []).length + 1;
