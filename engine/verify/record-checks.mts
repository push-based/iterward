import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { now } from '../util.mts';

/** Record a checks run for an attempt (the specs use it to stand in for a real run). */
export function recordChecks({ cfg }: Ctx, run: Run, rec: Record<string, unknown>): Run {
    (run.checks ??= []).push({ phase: Object.values(cfg.verify).find((v) => v.checks)?.phase, ...rec, at: now() });
    return run;
}
