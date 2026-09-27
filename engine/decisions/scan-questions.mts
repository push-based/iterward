import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Question, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { now } from '../util.mts';

/**
 * At the initial state, take each question file of the run folder that the ledger doesn't hold, in numeric order
 * of its {n}, as pending. The id is the file name without `.md`, and `file` is run-relative. Returns the new ones.
 */
export function scanQuestions({ cfg }: Ctx, runPath: string, run: Run): Question[] {
    const pattern = cfg.questions;
    if (!pattern || run.status !== cfg.initial) return [];
    const held = new Set(run.questions.map((q) => q.id));
    const askedAt = now();
    const found = readdirSync(dirname(runPath)).flatMap((file) => {
        const n = pattern.exec(file)?.[1];
        const id = file.replace(/\.md$/, '');
        return n === undefined || held.has(id) ? [] : [{ n: Number(n), q: { id, file, status: 'pending' as const, askedAt } }];
    });
    const taken = found.sort((a, b) => a.n - b.n).map((x) => x.q);
    run.questions.push(...taken);
    return taken;
}
