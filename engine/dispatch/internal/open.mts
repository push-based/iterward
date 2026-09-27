import { dirname, join } from 'node:path';

import type { Dispatch, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { group, SPILL_OVER, spillFile } from '../../spill.mts';
import { now } from '../../util.mts';
import { dispatchOut } from './dispatch-out.mts';

/**
 * Error lines after `lead`: on the next lines, grouped, or past SPILL_OVER characters counted on the same line,
 * with the file in the run folder's `out/` that holds them.
 */
export function listed(runPath: string, name: string, lines: string[], lead: string): string {
    const text = group(lines);
    return text.length <= SPILL_OVER ? `${lead}\n${text}` : `${lead} ${lines.length} errors, listed in ${spillFile(dirname(runPath), name, text)}.`;
}

/**
 * Open a dispatch: its message template filled, then, on a re-dispatch, the `Fixes:` it must make. `with` holds
 * the values the route supplied, and a re-dispatch keeps them. A placeholder with no value refuses the open.
 */
export function open(ctx: Ctx, runPath: string, run: Run, name: string, o: { with?: Record<string, string>; fixes?: string[] } = {}) {
    const { cfg } = ctx;
    const spec = cfg.dispatches[name];
    if (!spec) throw new Error(`the loop has no dispatch ${name}`);
    const earlier = run.dispatches.filter((d) => d.name === name);
    const attempt = earlier.length + 1;
    const document = join(dirname(runPath), cfg.artifacts[spec.artifact].file.replaceAll('{attempt}', String(attempt)));
    // The note of the latest human move after this dispatch last opened, so a later dispatch never re-applies an old note.
    const since = earlier.at(-1)?.openedAt ?? '';
    const note = run.history.findLast((h) => h.human && h.at > since)?.note ?? '';
    const inputs = Object.fromEntries([...cfg.inputs.required, ...(cfg.inputs.optional ?? [])].map((k) => [k, run.inputs[k] ?? 'none']));
    const values: Record<string, string> = { ...o.with, ...inputs, runPath, attempt: String(attempt), document, note };
    const message = spec.message.replace(/\{([^{}]*)\}/g, (_, p: string) => {
        if (!Object.hasOwn(values, p)) throw new Error(`the ${name} message names {${p}}, and nothing gives it a value`);
        return values[p];
    });
    const fixes = o.fixes?.length ? `\n${listed(runPath, `${name}-fixes`, o.fixes, 'Fixes:')}` : '';
    const d: Dispatch = { id: run.dispatches.length + 1, name, agent: spec.agent, attempt, document, message: `${message}${fixes}`, openedAt: now(), ...(o.with ? { with: o.with } : {}) };
    run.dispatches.push(d);
    return dispatchOut(d);
}
