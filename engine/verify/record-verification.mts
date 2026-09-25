import { readFileSync } from 'node:fs';

import { treeHash } from '../../checks.mts';
import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { requireFreshProof } from '../run/internal/require-fresh-proof.mts';
import { hasText, now } from '../util.mts';
import { attemptOf } from './attempt-of.mts';
import { appendAttempt } from './internal/append-attempt.mts';

/**
 * Record a verdict and route on it: the only way out of a verify state besides blocked. `obligations`
 * maps each obligation id the verifier proved to its evidence mode; modes aren't ranked.
 */
export function recordVerification(ctx: Ctx, run: Run, phase: string, verdict: string, proof: unknown, obligations: Record<string, string> = {}): Run {
    const { cfg, frozen } = ctx;
    const at = Object.keys(cfg.verify).find((s) => cfg.verify[s].phase === phase);
    if (!at) throw new Error(`verify --phase must be one of ${Object.values(cfg.verify).map((v) => v.phase).join(', ')}, not ${phase}`);
    const spec = cfg.verify[at];
    if (run.status !== at) throw new Error(`verify ${phase} needs status ${at}, not ${run.status}`);
    if (verdict !== 'pass' && verdict !== 'fail') throw new Error('verdict must be pass or fail');
    if (!hasText(proof)) throw new Error('verify requires a non-empty proof reference (the verifier report)');
    requireFreshProof(run, proof);
    if (verdict === 'pass' && spec.checks) {
        const attempt = attemptOf(run, phase);
        const fresh = (run.checks ?? []).findLast((c) => c.phase === phase && c.attempt === attempt);
        if (!fresh) throw new Error(`a ${phase} pass needs \`checks\` for this ${phase} attempt (${attempt}); run it and cite its rows`);
        if (!fresh.pass) throw new Error(`a ${phase} pass needs every check row to pass; ${fresh.path} has ${fresh.failed} failed and ${fresh.blocked} blocked row(s)`);
        // A record written before the tree hash existed carries none, and stays trusted.
        if (fresh.tree && cfg.checks && fresh.tree !== treeHash(process.cwd(), cfg.checks.ignore)) throw new Error(`the working tree changed since ${fresh.path} ran; run checks again and cite the new record`);
    }
    if (verdict === 'pass') {
        const list: any[] = ((frozen && run.docs?.[frozen]?.[ctx.obligationsField]) ?? []).filter((o: any) => o?.phase === phase);
        const unmet = list.filter((o) => obligations[o.id] !== o.tier);
        if (unmet.length) throw new Error(`a ${phase} pass needs proof of every ${phase} obligation in its evidence mode; unmet: ${unmet.map((o) => `${o.id} (${o.tier})`).join(', ')}`);
        const report = list.length ? readFileSync(String(proof), 'utf8') : '';
        const unnamed = list.filter((o) => !report.includes(o.id));
        if (unnamed.length) throw new Error(`a ${phase} pass needs a report that judges every ${phase} obligation; ${proof} never names ${unnamed.map((o) => o.id).join(', ')}`);
    }
    appendAttempt(run, phase, { verdict, at: now(), proof: String(proof), ...(Object.keys(obligations).length ? { obligations } : {}) });
    const to = verdict === 'pass' ? spec.pass : spec.fail;
    run.history.push({ from: run.status, to, at: now(), note: `${at} ${verdict}` });
    run.status = to;
    delete run.blockedFrom;
    return run;
}
