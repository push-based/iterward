import { existsSync, readFileSync } from 'node:fs';

import type { Action, Doc, Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText, isObj, sha256 } from '../util.mts';
import { apply } from './internal/apply.mts';
import { close } from './internal/close.mts';
import { open } from './internal/open.mts';
import { openDispatch } from './internal/open-dispatch.mts';
import { park } from './internal/park.mts';
import { streak } from './internal/streak.mts';
import { next, refused } from './next.mts';

/** The result field an action needs. */
const needs = (a: Action): string | undefined => {
    if ('store' in a) return a.from;
    if ('ask' in a) return a.ask;
    if ('supplement' in a) return 'requests';
    if ('dispatch' in a) return 'reason';
    if ('relay' in a) return a.relay;
    if ('invalidate' in a) return 'reason';
    if ('park' in a) return 'blockers';
    if ('verify' in a) return 'report';
    return undefined;
};

/** Read the open dispatch's result file and apply the loop's action for its agent and status. */
export function result(ctx: Ctx, runPath: string, run: Run): any {
    const d = openDispatch(run);
    if (!d) throw new Error('no open dispatch: run next first');
    const actions = ctx.cfg.results?.[d.agent] ?? {};
    let r: Doc;
    let text = '';
    let err: string | undefined;
    if (!existsSync(d.result)) err = `no result file at ${d.result}; write the result JSON there before you reply`;
    else {
        text = readFileSync(d.result, 'utf8');
        try {
            r = JSON.parse(text);
        } catch (e) {
            err = `the result file is not JSON: ${(e as Error).message}`;
        }
        if (!err && (!isObj(r) || !hasText(r.status) || !Object.hasOwn(actions, r.status))) err = `the result status must be one of ${Object.keys(actions).join(', ')}, not ${r?.status}`;
        const field = err ? undefined : needs(actions[r.status]);
        if (!err && field && (r[field] == null || r[field] === '' || (Array.isArray(r[field]) && !r[field].length))) err = `a ${r.status} result needs ${field}`;
    }
    const st = streak(run);
    if (err) {
        close(ctx, run, d, 'unusable', undefined, err);
        st.unusable += 1;
        if (st.unusable > ctx.limits.unusable) {
            st.unusable = 0;
            park(ctx, run, `${d.agent} returned no usable result twice: ${err}`);
            return next(ctx, runPath, run);
        }
        return open(ctx, runPath, run, d.name, { base: d.base, fixes: err, pass: d.pass, resume: d.resume });
    }
    st.unusable = 0;
    d.sha256 = sha256(text);
    const a = actions[r.status];
    try {
        const out = apply(ctx, runPath, run, d, a, r);
        st.refusals = 0;
        return out;
    } catch (e) {
        if (!d.closedAt) close(ctx, run, d, r.status, r, `refused: ${(e as Error).message}`);
        return refused(ctx, runPath, run, (e as Error).message, { name: 'store' in a ? a.onRefusal : undefined, source: d, limit: 'verify' in a ? a.maxRefusals : undefined });
    }
}
