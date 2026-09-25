import { readFileSync } from 'node:fs';

import type { Action, Dispatch, Doc, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { askQuestions } from '../../decisions/ask-questions.mts';
import { store } from '../../run/store.mts';
import { transition } from '../../run/transition.mts';
import { proofOnDisk } from '../../util.mts';
import { checks } from '../../verify/checks.mts';
import { invalidate } from '../../verify/invalidate.mts';
import { recordVerification } from '../../verify/record-verification.mts';
import { next } from '../next.mts';
import { close } from './close.mts';
import { open } from './open.mts';
import { park } from './park.mts';

/** Apply the loop's action for a usable result, then return the run's next move. */
export function apply(ctx: Ctx, runPath: string, run: Run, d: Dispatch, a: Action, r: Doc): any {
    const { cfg } = ctx;
    if ('store' in a) {
        store(ctx, runPath, run, a.store, String(r[a.from]));
        close(ctx, run, d, r.status, r);
        if (d.resume) {
            const origin = run.dispatches!.find((x) => x.id === d.resume)!;
            return open(ctx, runPath, run, origin.name, { base: `${origin.base}${cfg.resumeSuffix ?? ''}`, pass: origin.pass });
        }
        return next(ctx, runPath, run);
    }
    if ('ask' in a) {
        const doc = JSON.parse(readFileSync(String(r[a.ask]), 'utf8'));
        askQuestions(ctx, run, Array.isArray(doc) ? doc : doc.questions, { dispatch: d.id, agent: d.agent });
        close(ctx, run, d, r.status, r);
        return next(ctx, runPath, run);
    }
    if ('supplement' in a) {
        const again = run.dispatches!.some((x) => x.pass === d.pass && x.supplemented);
        close(ctx, run, d, r.status, r);
        if (again) {
            park(ctx, run, `${d.agent} returned ${r.status} twice in one pass: ${JSON.stringify(r.requests)}`);
            return next(ctx, runPath, run);
        }
        d.supplemented = true;
        return open(ctx, runPath, run, a.supplement, { extra: { result: r }, pass: d.pass, resume: d.id });
    }
    if ('dispatch' in a) {
        close(ctx, run, d, r.status, r);
        const count = run.dispatches!.filter((x) => x.agent === d.agent && x.outcome === r.status && x.cycle === d.cycle).length;
        if (count > a.maxPerCycle) {
            park(ctx, run, a.park(r));
            return next(ctx, runPath, run);
        }
        return open(ctx, runPath, run, a.dispatch, { fixes: a.fixes(r) });
    }
    if ('relay' in a) {
        close(ctx, run, d, r.status, r);
        return { do: 'relay', answer: r[a.relay] };
    }
    if ('transition' in a) {
        if (a.checks) {
            const res = checks(ctx, runPath, run, a.transition);
            if (!res.pass) throw new Error(`${a.transition} checks fail (${res.failed} failed, ${res.blocked} blocked); fix these rows and return ${r.status} again: ${res.rows.filter((x: any) => x.status !== 'pass').map((x: any) => `${x.name} ${x.status} (${x.log})`).join('; ')}`);
        }
        transition(ctx, run, a.transition);
    }
    else if ('invalidate' in a) invalidate(ctx, run, { reason: r.reason, refs: Array.isArray(r.refs) ? r.refs.map(String) : [], proof: proofOnDisk(r.report) });
    else if ('park' in a) park(ctx, run, r.blockers.map((b: any) => `${b?.topic}: ${b?.reason}`).join('; '), r.report);
    else if ('verify' in a) {
        const obligations = Object.fromEntries((Array.isArray(r.obligations) ? r.obligations : []).map((x: string) => String(x).split(':')));
        recordVerification(ctx, run, cfg.verify[run.status]?.phase, a.verify, proofOnDisk(r.report), obligations);
    }
    close(ctx, run, d, r.status, r);
    return next(ctx, runPath, run);
}
