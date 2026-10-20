import type { Run } from '../../../config.ts';
import type { Ctx } from '../../context.ts';
import { isObj } from '../../util.ts';

/** Refuse a run whose fields don't have the types the engine reads. */
export function validateShape(ctx: Ctx, run: Run) {
    if (!isObj(run)) throw new Error('invalid run shape: not an object');
    const bad = [];
    if (!ctx.statuses.includes(run.status)) bad.push(`status must be one of ${ctx.statuses.join(', ')}`);
    if (!isObj(run.config) || typeof run.config.path !== 'string' || typeof run.config.sha256 !== 'string') bad.push('config must name the loop file and its sha256');
    if (typeof run.engine !== 'string') bad.push('engine must name the Iterward version that started the run');
    for (const k of ['inputs', 'gates', 'freezes'] as const) if (!isObj(run[k])) bad.push(`${k} must be an object`);
    for (const k of ['warnings', 'history', 'questions', 'dispatches'] as const) if (!Array.isArray(run[k])) bad.push(`${k} must be an array`);
    if (bad.length) throw new Error(`invalid run shape: ${bad.join('; ')}`);
}
