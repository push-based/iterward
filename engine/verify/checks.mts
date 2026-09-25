import { runChecks } from '../../checks.mts';
import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { now } from '../util.mts';
import { attemptOf } from './attempt-of.mts';

/**
 * Run the loop's check rows for the current attempt of a verify phase and record them. `at` is the verify
 * status; a transition into it runs them before the move.
 */
export function checks({ cfg, frozen }: Ctx, runPath: string, run: Run, at: string = run.status): any {
    const spec = cfg.verify[at];
    if (!spec?.checks || !cfg.checks) throw new Error(`checks run only at status ${Object.keys(cfg.verify).filter((s) => cfg.verify[s].checks).join(', ')}, not ${at}`);
    const attempt = attemptOf(run, spec.phase);
    const k = (run.checks ?? []).filter((x) => x.phase === spec.phase && x.attempt === attempt).length + 1;
    const stem = k === 1 ? `checks.${attempt}` : `checks.${attempt}-${k}`;
    const res = runChecks(runPath, { root: process.cwd(), stem, ignore: cfg.checks.ignore, rows: cfg.checks.rows, doc: frozen ? run.docs?.[frozen] : undefined });
    (run.checks ??= []).push({ phase: spec.phase, attempt, path: `${stem}.json`, pass: res.pass, failed: res.failed, blocked: res.blocked, tree: res.tree, at: now() });
    return { attempt, ...res };
}
