import { readFileSync } from 'node:fs';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { validateShape } from './internal/validate-shape.mts';

/** Read a run and check its shape; a run started under another loop file or hook module is refused. */
export function loadRun(ctx: Ctx, path: string): Run {
    const run: Run = JSON.parse(readFileSync(path, 'utf8'));
    validateShape(ctx, run);
    if (run.config.sha256 !== ctx.cfg.sha256) throw new Error(`the loop changed since the run started (${run.config.path} or a hook module it names); start a new run`);
    return run;
}
