import { existsSync } from 'node:fs';

import type { Run } from '../../config.ts';
import { type Ctx, inRunDir } from '../context.ts';
import { fileSha256, now } from '../util.ts';

/** A frozen file is missing or changed. No agent can repair one, so an agent's move parks and a human move is refused. */
export class FreezeError extends Error {}

/** Record a file of the run folder as frozen by a gate or a question. */
export function freeze(runPath: string, run: Run, file: string, by: string) {
    const path = inRunDir(runPath, file);
    if (!existsSync(path)) throw new Error(`${by} freezes ${file}, and the run folder holds none`);
    run.freezes[file] = { sha256: fileSha256(path), by, at: now() };
}

/** Throw a FreezeError when a frozen file is missing or changed, naming the gate or the question that froze it. */
export function checkFreezes({ cfg }: Ctx, runPath: string, run: Run) {
    const broken = Object.entries(run.freezes).flatMap(([file, f]) => {
        const path = inRunDir(runPath, file);
        const by = cfg.gates[f.by]?.label ?? f.by;
        if (!existsSync(path)) return [`${file} is missing, and ${by} froze it`];
        return fileSha256(path) === f.sha256 ? [] : [`${file} changed after ${by} froze it`];
    });
    if (broken.length) throw new FreezeError(broken.join('\n'));
}

/**
 * The gate whose freeze a human move into `to` drops: the gate `to` itself, whose files the human judges again, or
 * the gate that froze the artifact the step `to` writes. A move into a gate is how a human releases the freeze of
 * an artifact that code writes, which no step rewrites.
 */
export function dropsOf({ cfg }: Ctx, run: Run, to: string): string | undefined {
    const active = (g: string) => Object.values(run.freezes).some((f) => f.by === g);
    if (cfg.gates[to]) return active(to) ? to : undefined;
    const a = cfg.steps[to]?.writes;
    if (!a) return undefined;
    return Object.entries(cfg.gates).find(([g, x]) => x.freezes.includes(a) && active(g))?.[0];
}
