import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { activeDecisionIds } from '../decisions/active-decision-ids.mts';

/** The summary of a gate (the first gate with one, unless named). */
export function summary({ cfg }: Ctx, runPath: string, run: Run, name?: string): unknown {
    const gate = name ?? Object.keys(cfg.gates).find((g) => cfg.gates[g].summary);
    const fn = gate ? cfg.gates[gate]?.summary : undefined;
    if (!fn) throw new Error(`no gate summary${name ? ` for ${name}` : ''}`);
    return fn({ run, runPath, active: activeDecisionIds(run) });
}
