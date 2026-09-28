import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText } from '../util.mts';

/**
 * A fresh run at the loop's first step, which the caller saves. The loop's preflight runs first: an error refuses
 * the run, so nothing is written, and each warning is kept with its reason. `configPath` is the loop file as
 * the command received it.
 */
export async function newRun({ cfg }: Ctx, runPath: string, inputs: Record<string, unknown>, configPath: string): Promise<Run> {
    for (const k of cfg.inputs.required) if (!hasText(inputs[k])) throw new Error(`a new run needs --${k}`);
    const declared = [...cfg.inputs.required, ...(cfg.inputs.optional ?? [])];
    const kept = Object.fromEntries(declared.filter((k) => hasText(inputs[k])).map((k) => [k, String(inputs[k])]));
    const { errors, warnings } = (await cfg.preflight?.({ root: process.cwd(), runPath, inputs: kept })) ?? { errors: [], warnings: [] };
    if (errors.length) throw new Error(errors.join('\n'));
    return {
        config: { path: configPath, sha256: cfg.sha256 },
        inputs: kept,
        status: cfg.start,
        warnings: [...warnings],
        gates: {},
        history: [],
        freezes: {},
        questions: [],
        dispatches: [],
    };
}
