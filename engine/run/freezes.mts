import { existsSync } from 'node:fs';

import type { Run } from '../../config.mts';
import { type Ctx, inRunDir } from '../context.mts';
import { fileSha256, now } from '../util.mts';

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
