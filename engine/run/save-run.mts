import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { validateShape } from './internal/validate-shape.mts';

const frozenAfterApproval = ({ freezeGate }: Ctx, run: Run) => freezeGate != null && run.gates?.[freezeGate]?.decision === 'approved';

/** Write a run, refusing a change to the frozen artifact after its gate approved it. */
export function saveRun(ctx: Ctx, path: string, run: Run): Run {
    const { cfg, frozen, freezeGate } = ctx;
    validateShape(ctx, run);
    const { docs, ...stored } = run;
    if (frozen && existsSync(path)) {
        const prev = JSON.parse(readFileSync(path, 'utf8'));
        if (frozenAfterApproval(ctx, prev) && prev.artifacts?.[frozen]?.sha256 !== run.artifacts?.[frozen]?.sha256) {
            throw new Error(`${frozen} is frozen after ${cfg.gates[freezeGate!].label}; only invalidate can re-open it`);
        }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);
    return run;
}
