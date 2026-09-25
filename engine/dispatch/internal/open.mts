import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Dispatch, Doc, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { now } from '../../util.mts';
import { show } from '../../views/show.mts';
import { dispatchOut } from './dispatch-out.mts';

/** Open a dispatch: its message, then any Fixes, then the result path. A stale file at that path is removed. */
export function open(ctx: Ctx, runPath: string, run: Run, name: string, o: { base?: string; fixes?: string; pass?: number; resume?: number; extra?: { result?: Doc; text?: string } } = {}) {
    const spec = ctx.cfg.dispatches?.[name];
    if (!spec) throw new Error(`the loop has no dispatch ${name}`);
    const id = (run.dispatches ?? []).length + 1;
    const base = o.base ?? spec.message(show(ctx, runPath, run), o.extra ?? {});
    const result = join(dirname(runPath), 'results', `${id}.json`);
    mkdirSync(dirname(result), { recursive: true });
    rmSync(result, { force: true });
    const message = `${base}${o.fixes ? ` Fixes: ${o.fixes}` : ''} Result: ${result}.`;
    const d: Dispatch = { id, name, agent: spec.agent, base, message, result, pass: o.pass ?? id, ...(o.resume ? { resume: o.resume } : {}), openedAt: now() };
    (run.dispatches ??= []).push(d);
    return dispatchOut(d);
}
