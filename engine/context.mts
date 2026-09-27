import { dirname, join, resolve } from 'node:path';

import type { HookContext, LoopConfig, Run } from '../config.mts';

/** A loop configuration and the values every operation derives from it. */
export interface Ctx {
    cfg: LoopConfig;
    /** Every state a run can stand at, `blocked` included. */
    statuses: string[];
}

export const context = (cfg: LoopConfig): Ctx => ({ cfg, statuses: Object.keys(cfg.states) });

/** What every hook receives: the repository root is the working directory, and the run folder is absolute. */
export const hookCtx = (runPath: string, run: Run): HookContext => ({ root: process.cwd(), runPath, runDir: resolve(dirname(runPath)), run });

/** The absolute path of a file in the run folder. */
export const inRunDir = (runPath: string, file: string): string => join(resolve(dirname(runPath)), file);

/** The run-relative file of each artifact a gate freezes, in the gate's order. */
export const frozenFiles = ({ cfg }: Ctx, gate: string): string[] => cfg.gates[gate].freezes.map((a) => cfg.artifacts[a].file);
