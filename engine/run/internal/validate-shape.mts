import type { Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { isObj } from '../../util.mts';

/** Refuse a run whose fields don't have the types the engine reads. */
export function validateShape(ctx: Ctx, run: Run) {
    if (!isObj(run)) throw new Error('invalid run shape: not an object');
    const bad = [];
    if (!ctx.statuses.includes(run.status)) bad.push(`status must be one of ${ctx.statuses.join(', ')}`);
    if (!isObj(run.config) || typeof run.config.path !== 'string' || typeof run.config.sha256 !== 'string') bad.push('config must name the loop file and its sha256');
    for (const k of ['inputs', 'gates', 'freezes'] as const) if (!isObj(run[k])) bad.push(`${k} must be an object`);
    for (const k of ['warnings', 'history', 'questions', 'dispatches'] as const) if (!Array.isArray(run[k])) bad.push(`${k} must be an array`);
    if (bad.length) throw new Error(`invalid run shape: ${bad.join('; ')}`);
}
