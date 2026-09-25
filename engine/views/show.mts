import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Ref, Run, Show } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { activeDecisionIds } from '../decisions/active-decision-ids.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { draftPath } from './internal/draft-path.mts';
import { failedSince } from './internal/failed-since.mts';
import { routeCtx } from './internal/route-ctx.mts';

/** A compact summary of the run; artifact files are named by path, so an agent reads a field, never the run. */
export function show(ctx: Ctx, runPath: string, run: Run): Show {
    const { cfg, freezeGate, frozen } = ctx;
    const beside = (ref?: Ref) => (ref?.path ? join(dirname(runPath), ref.path) : null);
    const draft = draftPath(ctx, runPath);
    const inv = run.invalidations?.at(-1);
    const parked = run.status === 'blocked' ? run.history.findLast((h) => h.to === 'blocked') : undefined;
    const g = freezeGate ? run.gates[freezeGate] : undefined;
    const rejected = g?.decision === 'rejected' ? g.history?.at(-1) : undefined;
    const cycle = frozen ? run.artifacts[frozen] : undefined;
    // The human's notes since the frozen artifact's last store: what this planning cycle must answer.
    const notes = [
        ...(rejected && rejected.judged?.path === cycle?.path ? [{ from: freezeGate, note: rejected.note }] : []),
        ...(inv && inv.retired?.path === cycle?.path ? [{ from: 'invalidation', note: inv.reason }] : []),
        ...(run.redirects ?? []).filter((x) => x.refs?.[frozen as string] === cycle?.n).map((x) => ({ from: 'redirect', note: x.note })),
    ];
    const inputs = Object.fromEntries([...cfg.inputs.required, ...(cfg.inputs.optional ?? [])].map((k) => [k, run.inputs[k] ?? null]));
    return {
        runPath, ...inputs, status: run.status, blockedFrom: run.blockedFrom,
        ...(run.status === cfg.initial && cfg.route ? { next: cfg.route(routeCtx(ctx, runPath, run)) } : {}),
        ...Object.fromEntries(Object.keys(cfg.artifacts).map((k) => [k, beside(run.artifacts[k])])),
        ...(cfg.draft ? { draft: draft && existsSync(draft) ? draft : null } : {}),
        ...(run.status === cfg.initial && notes.length ? { notes } : {}),
        ledger: { active: activeDecisionIds(run).size, pending: pendingQuestions(run).length },
        gates: Object.fromEntries(Object.entries(run.gates).filter(([, x]) => x.decision).map(([k, x]) => [k, { decision: x.decision, note: x.note, answeredAt: x.answeredAt }])),
        ...(run.redirects?.length ? { lastRedirect: { note: run.redirects.at(-1).note, retired: run.redirects.at(-1).retired, at: run.redirects.at(-1).at } } : {}),
        ...(rejected ? { lastRejection: { candidate: beside(rejected.judged), note: rejected.note, scope: rejected.scope, ...(rejected.recorded ? { recorded: rejected.recorded, supersedes: rejected.supersedes } : {}) } } : {}),
        ...(run.verifications ? { verifications: Object.fromEntries(Object.entries(run.verifications).map(([k, v]: [string, any]) => [k, { verdict: v.verdict, proof: v.proof, at: v.at, attempts: (v.attempts ?? []).length, failed: failedSince(ctx, run, k) }])) } : {}),
        ...(parked ? { blocked: { reason: parked.note, ...(parked.proof ? { proof: parked.proof } : {}), at: parked.at } } : {}),
        ...(inv ? { lastInvalidation: { reason: inv.reason, refs: inv.refs ?? [], ...(inv.proof ? { proof: inv.proof } : {}), from: inv.from, at: inv.at, retired: beside(inv.retired) } } : {}),
    };
}
