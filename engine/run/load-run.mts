import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Doc, Ref, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { sha256 } from '../util.mts';
import { validateShape } from './internal/validate-shape.mts';

function readRef(ctx: Ctx, runPath: string, name: string, ref: Ref): Doc {
    const text = readFileSync(join(dirname(runPath), ref.path), 'utf8');
    if (sha256(text) !== ref.sha256) throw new Error(`${ref.path} changed since store ${name} (sha256 mismatch); only store ${name} (status ${ctx.cfg.initial}) writes it`);
    return JSON.parse(text);
}

/** Read a run and check its shape; every artifact file is hash-checked and attached as `run.docs`. */
export function loadRun(ctx: Ctx, path: string): Run {
    const run = JSON.parse(readFileSync(path, 'utf8'));
    validateShape(ctx, run);
    run.docs = Object.fromEntries(Object.entries(run.artifacts as Record<string, Ref>).map(([name, ref]) => [name, readRef(ctx, path, name, ref)]));
    return run;
}
