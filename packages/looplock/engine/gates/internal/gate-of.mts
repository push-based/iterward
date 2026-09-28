import type { GateConfig, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';

/** The named gate, refused unless the run stands at it. */
export function gateOf({ cfg }: Ctx, run: Run, name: string): GateConfig {
    const g = cfg.gates[name];
    if (!g) throw new Error(`gate takes ${Object.keys(cfg.gates).join(', ')}, not ${name}`);
    if (run.status !== name) throw new Error(`gate ${name} needs status ${name}, not ${run.status}`);
    return g;
}
