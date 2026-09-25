import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { gateReady } from '../gates/internal/gate-ready.mts';
import { hasText, now } from '../util.mts';
import { requireFreshProof } from './internal/require-fresh-proof.mts';

/** Move along the state graph. A gate's forward exit needs its approval; blocked needs a note. */
export function transition(ctx: Ctx, run: Run, to: string, note?: string, proof?: string): Run {
    const { cfg } = ctx;
    const allowed = cfg.states[run.status] ?? [];
    if (!allowed.includes(to)) throw new Error(`illegal transition ${run.status} → ${to} (allowed: ${allowed.join(', ') || 'none'})`);
    const gate = cfg.gates[run.status];
    if (gate && to === gate.next && run.gates?.[run.status]?.decision !== 'approved') {
        throw new Error(`${run.status} → ${to} requires ${gate.label} approval; use gate ${run.status} --decision approved`);
    }
    if (run.status === cfg.initial && cfg.gates[to]) gateReady(ctx, run, to);
    if (to === 'blocked' && !hasText(note)) throw new Error('a move to blocked needs a note stating the blockers, so the parked run can explain itself');
    if (to === 'blocked' && proof) requireFreshProof(run, proof);
    if (run.status === 'blocked' && to !== run.blockedFrom) throw new Error(`a blocked run resumes only into ${run.blockedFrom ?? 'its origin'}, not ${to}`);
    if (to === 'blocked' && ctx.resumable.has(run.status)) run.blockedFrom = run.status;
    run.history.push({ from: run.status, to, at: now(), ...(note ? { note } : {}), ...(proof ? { proof: String(proof) } : {}) });
    run.status = to;
    if (to !== 'blocked') delete run.blockedFrom;
    return run;
}
