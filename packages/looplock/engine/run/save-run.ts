import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Run } from '../../config.ts';
import type { Ctx } from '../context.ts';
import { validateShape } from './internal/validate-shape.ts';

/**
 * Write a run. Only the engine writes run.json, and only after a command succeeds. The run goes to
 * `<path>.<pid>.tmp` and is renamed over `path`, so a reader never sees a partial file.
 */
export function saveRun(ctx: Ctx, path: string, run: Run): Run {
    validateShape(ctx, run);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(run, null, 2)}\n`);
    try {
        renameSync(tmp, path);
    } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
    }
    return run;
}
