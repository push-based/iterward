import { readFileSync } from 'node:fs';

import type { Run } from '../../config.ts';
import type { Ctx } from '../context.ts';
import { VERSION, versionLine } from '../util.ts';
import { validateShape } from './internal/validate-shape.ts';

/** Read a run and check its shape; a run started under another version line of the engine, loop file, or hook module is refused. */
export function loadRun(ctx: Ctx, path: string): Run {
    const run: Run = JSON.parse(readFileSync(path, 'utf8'));
    validateShape(ctx, run);
    const line = versionLine(run.engine);
    if (line !== versionLine(VERSION)) throw new Error(`the run started under looplock ${run.engine}, and this is looplock ${VERSION}; continue it with npx @push-based/looplock@${line}, or start a new run`);
    if (run.config.sha256 !== ctx.cfg.sha256) throw new Error(`the loop changed since the run started (${run.config.path} or a hook module it names); start a new run`);
    return run;
}
