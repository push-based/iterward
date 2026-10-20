import type { GateConfig, Run } from '../../../config.ts';
import type { Ctx } from '../../context.ts';

/** The named gate, refused unless the run stands at it. */
export function gateOf({ cfg }: Ctx, run: Run, name: string): GateConfig {
    const g = Object.hasOwn(cfg.gates, name) ? cfg.gates[name] : undefined;
    if (!g) throw new Error(`gate takes ${Object.keys(cfg.gates).join(', ')}, not ${name}`);
    if (run.status !== name) throw new Error(`gate ${name} needs status ${name}, not ${run.status}`);
    return g;
}
