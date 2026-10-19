import { existsSync } from 'node:fs';

import type { DispatchInfo, Run } from '../../../config.ts';
import { type Ctx, frozenFiles, hookCtx, inRunDir } from '../../context.ts';
import { pendingQuestions } from '../../decisions/pending-questions.ts';
import { errorsOf } from '../../util.ts';

/**
 * The checks on entering a gate and on approving it: no pending question, then each frozen artifact's guard
 * with `event`, in the gate's order, then every frozen file present (a guard can write one). A guard's status
 * counts for nothing here, only its errors. Throws the error lines.
 */
export async function gateReady(ctx: Ctx, runPath: string, run: Run, gate: string, event: 'enter' | 'approve', dispatch?: DispatchInfo) {
    const { cfg } = ctx;
    const g = cfg.gates[gate];
    const pending = pendingQuestions(run);
    if (pending.length) throw new Error(`${g.label} needs every question answered; pending: ${pending.map((q) => q.id).join(', ')}`);
    const errors: string[] = [];
    for (const a of g.freezes) {
        const { file, guard } = cfg.artifacts[a];
        if (guard) errors.push(...errorsOf(await guard(inRunDir(runPath, file), { ...hookCtx(runPath, run), event, ...(dispatch ? { dispatch } : {}) })));
    }
    for (const file of frozenFiles(ctx, gate)) if (!existsSync(inRunDir(runPath, file))) errors.push(`${g.label} freezes ${file}, and the run folder holds none`);
    if (errors.length) throw new Error(errors.join('\n'));
}
