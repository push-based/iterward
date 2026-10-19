import { existsSync } from 'node:fs';

import type { Run } from '../../../config.ts';
import { type Ctx, frozenFiles, inRunDir } from '../../context.ts';
import { fileSha256, hasText, now } from '../../util.ts';

/** Record a gate decision, and append it to the gate's history with `judged`: the sha256 of each file the gate freezes. */
export function recordGate(ctx: Ctx, runPath: string, run: Run, name: string, decision: 'approved' | 'rejected', note?: string) {
    const at = now();
    const judged = Object.fromEntries(frozenFiles(ctx, name).filter((f) => existsSync(inRunDir(runPath, f))).map((f) => [f, fileSha256(inRunDir(runPath, f))]));
    const noted = hasText(note) ? { note } : {};
    run.gates[name] = { decision, ...noted, at, history: [...(run.gates[name]?.history ?? []), { decision, ...noted, at, judged }] };
}
