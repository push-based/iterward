import { dirname, join } from 'node:path';

import type { Dispatch, Run } from '../../../config.ts';
import type { Ctx } from '../../context.ts';
import { group, SPILL_OVER, spillFile } from '../../spill.ts';
import { now } from '../../util.ts';
import { lastHumanAt } from '../../views/internal/since-human.ts';
import { dispatchOut } from './dispatch-out.ts';

/**
 * Error lines after `lead`: on the next lines, grouped, or past SPILL_OVER characters counted on the same line,
 * with the file in the run folder's `out/` that holds them.
 */
export function listed(runPath: string, name: string, lines: string[], lead: string): string {
    const text = group(lines);
    return text.length <= SPILL_OVER ? `${lead}\n${text}` : `${lead} ${lines.length} errors, listed in ${spillFile(dirname(runPath), name, text)}.`;
}

/** Continuation lines indented, so a multi-line value stays one field of the message. */
const indent = (text: string) => text.replaceAll('\n', '\n  ');

/**
 * Open a step with the standard message: the step, the run file, the document to write, the inputs, the human's
 * latest note, and the lines to fix. `{attempt}` counts the dispatches that wrote the same artifact. The note is
 * the latest human move's after the step last opened, so a later open never re-applies an old note. The fixes
 * are the step's own previous dispatch's, unless a human moved since.
 */
export function open(ctx: Ctx, runPath: string, run: Run, name: string) {
    const { cfg } = ctx;
    const step = cfg.steps[name];
    if (!step) throw new Error(`the loop has no step ${name}`);
    const attempt = run.dispatches.filter((d) => cfg.steps[d.name]?.writes === step.writes).length + 1;
    const document = join(dirname(runPath), cfg.artifacts[step.writes].file.replaceAll('{attempt}', String(attempt)));
    const since = run.dispatches.findLast((d) => d.name === name)?.openedAt ?? '';
    const note = run.history.findLast((h) => h.human && h.at > since)?.note;
    const last = run.dispatches.at(-1);
    const fixes = last?.name === name && last.openedAt >= lastHumanAt(run) ? (last.fixes ?? []) : [];
    const inputs = [...cfg.inputs.required, ...(cfg.inputs.optional ?? [])].map((k) => `\n  ${k}: ${indent(run.inputs[k] ?? 'none')}`).join('');
    const message = [
        `Step: ${name}`,
        `Run: ${runPath}`,
        `Document: ${document}`,
        `Inputs:${inputs || ' none'}`,
        `Note: ${note ? indent(note) : 'none'}`,
        fixes.length ? listed(runPath, `${name}-fixes`, fixes, 'Fixes:') : 'Fixes: none',
    ].join('\n');
    const d: Dispatch = { id: run.dispatches.length + 1, name, agent: step.agent, attempt, document, message, openedAt: now() };
    run.dispatches.push(d);
    return dispatchOut(d);
}
