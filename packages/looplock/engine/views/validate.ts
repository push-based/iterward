import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Run } from '../../config.ts';
import { type Ctx, hookCtx, inRunDir } from '../context.ts';
import { info, openDispatch } from '../dispatch/internal/open-dispatch.ts';
import { errorsOf } from '../util.ts';

/**
 * Run an artifact's guard with `event: 'validate'` on its file, and return its error lines, none when it returns
 * a status. A per-attempt
 * artifact validates its highest-numbered existing file. An artifact without a guard has nothing to refuse.
 */
export async function validate({ cfg }: Ctx, runPath: string, run: Run, artifact: string): Promise<string[]> {
    const a = Object.hasOwn(cfg.artifacts, artifact) ? cfg.artifacts[artifact] : undefined;
    if (!a) throw new Error(`validate takes ${Object.keys(cfg.artifacts).join(', ')}, not ${artifact}`);
    let file = a.file;
    if (file.includes('{attempt}')) {
        const [head, tail] = file.split('{attempt}');
        const n = Math.max(0, ...readdirSync(dirname(runPath)).map((f) => (f.startsWith(head) && f.endsWith(tail) ? Number(f.slice(head.length, f.length - tail.length)) : 0)).filter(Number.isInteger));
        if (!n) throw new Error(`the run folder holds no ${file}`);
        file = `${head}${n}${tail}`;
    }
    const path = inRunDir(runPath, file);
    if (!existsSync(path)) throw new Error(`the run folder holds no ${file}`);
    const o = openDispatch(run);
    return a.guard ? errorsOf(await a.guard(path, { ...hookCtx(runPath, run), event: 'validate', ...(o ? { dispatch: info(o) } : {}) })) : [];
}
