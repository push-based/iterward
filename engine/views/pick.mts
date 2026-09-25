import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { isObj, resolvePointer } from '../util.mts';
import { draftPath } from './internal/draft-path.mts';

/**
 * One field of an artifact file or the draft: an RFC 6901 `pointer`, and optionally `fields` (each item
 * of a list, or the object, cut to those keys) or `keys` (an object's keys, a list's length).
 */
export function pick(ctx: Ctx, runPath: string, run: Run, { file, pointer = '', fields, keys }: { file: string; pointer?: string; fields?: string; keys?: boolean }) {
    const { cfg } = ctx;
    const names = [...Object.keys(cfg.artifacts), ...(cfg.draft ? ['draft'] : [])];
    const out = join(dirname(runPath), 'out');
    const spilled = !names.includes(file) && resolve(file).startsWith(`${resolve(out)}/`);
    if (!names.includes(file) && !spilled) throw new Error(`--file is ${names.join(', ')}, or a file under ${out}, not ${file}`);
    const path = spilled ? file : file === 'draft' ? draftPath(ctx, runPath) : run.artifacts[file] && join(dirname(runPath), run.artifacts[file].path);
    if (!path || !existsSync(path)) throw new Error(`the run has no ${file} file yet`);
    let value = resolvePointer(JSON.parse(readFileSync(path, 'utf8')), pointer);
    if (value === undefined) throw new Error(`${pointer} does not resolve in ${path}`);
    if (fields) {
        const ks = fields.split(',');
        const cutTo = (x: any) => (isObj(x) ? Object.fromEntries(ks.filter((k) => k in x).map((k) => [k, x[k]])) : x);
        value = Array.isArray(value) ? value.map(cutTo) : cutTo(value);
    }
    if (keys) value = Array.isArray(value) ? { length: value.length } : isObj(value) ? Object.keys(value) : value;
    return { file: path, pointer, value };
}
