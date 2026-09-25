import type { Run } from '../../../config.mts';

/** Every proof report the run cites: verify attempts, invalidations, and moves to blocked. */
export function citedProofs(run: Run): Set<string> {
    return new Set([
        ...Object.values(run.verifications ?? {}).flatMap((v: any) => (v?.attempts ?? []).map((a: any) => a.proof)),
        ...(run.invalidations ?? []).map((i) => i.proof),
        ...(run.history ?? []).map((h) => h.proof),
    ].filter(Boolean));
}
