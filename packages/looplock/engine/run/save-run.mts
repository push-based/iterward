import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { validateShape } from './internal/validate-shape.mts';

/** Write a run. Only the engine writes run.json, and only after a command succeeds. */
export function saveRun(ctx: Ctx, path: string, run: Run): Run {
    validateShape(ctx, run);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`);
    return run;
}
