import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText } from '../util.mts';

/** A fresh run at the initial state. `config` is the configuration file's path and sha256. */
export function newRun(ctx: Ctx, inputs: Record<string, unknown>, config?: { path: string; sha256: string }): Run {
    const { cfg } = ctx;
    for (const k of cfg.inputs.required) if (!hasText(inputs[k])) throw new Error(`a new run needs --${k}`);
    const declared = [...cfg.inputs.required, ...(cfg.inputs.optional ?? [])];
    const kept = Object.fromEntries(declared.filter((k) => hasText(inputs[k])).map((k) => [k, String(inputs[k])]));
    return { ...(config ? { config } : {}), inputs: kept, status: cfg.initial, gates: {}, artifacts: {}, seq: 0, history: [] };
}
