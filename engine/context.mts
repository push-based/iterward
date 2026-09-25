import type { LoopConfig } from '../config.mts';

/** A loop configuration and the values every operation derives from it. */
export interface Ctx {
    cfg: LoopConfig;
    statuses: string[];
    /** The states a blocked run can resume into. */
    resumable: Set<string>;
    decisionsField: string;
    obligationsField: string;
    /** The gate that freezes an artifact, and that artifact. */
    freezeGate?: string;
    frozen?: string;
    limits: { redispatch: number; unusable: number; dispatchMinutes?: number; failed?: NonNullable<LoopConfig['limits']>['failed'] };
}

export function context(cfg: LoopConfig): Ctx {
    const freezeGate = Object.keys(cfg.gates).find((g) => cfg.gates[g].freezes);
    return {
        cfg,
        statuses: Object.keys(cfg.states),
        resumable: new Set(cfg.states.blocked ?? []),
        decisionsField: cfg.decisionsField ?? 'decisionsApplied',
        obligationsField: cfg.obligationsField ?? 'obligations',
        freezeGate,
        frozen: freezeGate ? cfg.gates[freezeGate].freezes : undefined,
        limits: { redispatch: 2, unusable: 1, ...cfg.limits },
    };
}
