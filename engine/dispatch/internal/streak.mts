import type { Run } from '../../../config.mts';

/** The run's consecutive refused and unusable results. */
export const streak = (run: Run) => (run.streak ??= { refusals: 0, unusable: 0 });
