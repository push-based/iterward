import type { Dispatch, Doc, Run } from '../../../config.mts';
import type { Ctx } from '../../context.mts';
import { hasText, now } from '../../util.mts';

/** Close a dispatch with its outcome, and keep the result's gaps and report. */
export function close({ frozen }: Ctx, run: Run, d: Dispatch, outcome: string, r?: Doc, note?: string) {
    Object.assign(d, { closedAt: now(), outcome, ...(note ? { note } : {}), ...(Array.isArray(r?.gaps) && r.gaps.length ? { gaps: r.gaps } : {}), ...(hasText(r?.report) ? { report: r.report } : {}), cycle: frozen ? run.artifacts[frozen]?.n ?? 0 : 0 });
}
