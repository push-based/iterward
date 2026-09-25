import type { LedgerCounts, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';

const ledgerCounts = (run: Run): LedgerCounts => ({
    decisions: (run.decisions ?? []).length,
    redirects: (run.redirects ?? []).length,
    invalidations: (run.invalidations ?? []).length,
    gates: Object.fromEntries(Object.entries(run.gates ?? {}).map(([k, g]) => [k, (g?.history ?? []).length])),
});
const NO_LEDGER: LedgerCounts = { decisions: 0, redirects: 0, invalidations: 0, gates: {} };

/** The human's words the ledger recorded between two ledger sizes, as stored, in the order recorded. */
function recordedBetween(run: Run, a: LedgerCounts, b: LedgerCounts) {
    return [
        ...(run.decisions ?? []).slice(a.decisions, b.decisions).map((d) => ({ at: d.at, record: 'answer', id: d.id, answer: d.answer, chosen: d.chosen, chosenText: d.chosenText })),
        ...(run.redirects ?? []).slice(a.redirects, b.redirects).map((r) => ({ at: r.at, record: 'redirect', note: r.note, retired: r.retired })),
        ...(run.invalidations ?? []).slice(a.invalidations, b.invalidations).map((i) => ({ at: i.at, record: 'invalidate', reason: i.reason })),
        ...Object.entries(b.gates).flatMap(([name, n]) => (run.gates[name]?.history ?? []).slice(a.gates[name] ?? 0, n)
            .map((h: any) => ({ at: h.at, record: 'gate', gate: name, decision: h.decision, ...(h.note ? { note: h.note } : {}), ...(h.scope ? { scope: h.scope } : {}) }))),
    ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

/**
 * A stop, with the dispatch records since the previous stop and, under `recorded`, the human's words the
 * ledger stored since then, so the human sees what the run recorded. Repeating the same stop repeats both.
 */
export function stop({ limits }: Ctx, run: Run, body: Record<string, unknown>) {
    const n = (run.dispatches ?? []).length;
    const m = run.stopMark ?? { from: 0, to: 0 };
    if (m.to !== n || !m.ledgerTo) run.stopMark = m.to !== n ? { from: m.to, to: n, ledgerFrom: m.ledgerTo ?? NO_LEDGER, ledgerTo: ledgerCounts(run) } : { ...m, ledgerFrom: NO_LEDGER, ledgerTo: ledgerCounts(run) };
    const { from, to, ledgerFrom = NO_LEDGER, ledgerTo = NO_LEDGER } = run.stopMark ?? m;
    const since = (run.dispatches ?? []).slice(from, to).map((d) => {
        const minutes = d.closedAt ? Math.round((Date.parse(d.closedAt) - Date.parse(d.openedAt)) / 6000) / 10 : undefined;
        const slow = minutes != null && limits.dispatchMinutes != null && minutes > limits.dispatchMinutes;
        return { id: d.id, agent: d.agent, outcome: d.outcome, ...(minutes != null ? { minutes } : {}), ...(slow ? { slow: true } : {}), ...(d.note ? { note: d.note } : {}), ...(d.report ? { report: d.report } : {}), ...(d.gaps?.length ? { gaps: d.gaps } : {}) };
    });
    const recorded = recordedBetween(run, ledgerFrom, ledgerTo);
    return { do: 'stop', ...body, since, ...(recorded.length ? { recorded } : {}) };
}
