/**
 * looplock configuration — the types a loop author writes against, and the run record a loop's callbacks
 * read. A loop is a module whose default export is `defineLoop({...})`.
 */

import type { RowsHarness } from './checks.mts';

// ponytail: artifact documents are untyped JSON here; a loop's guards give them their meaning.
export type Doc = any;

export interface Ref { path: string; sha256: string; at: string; n: number; seq: number }

export interface Run {
    config?: { path: string; sha256: string };
    inputs: Record<string, string>;
    status: string;
    blockedFrom?: string;
    gates: Record<string, any>;
    history: Array<{ from: string; to: string; at: string; note?: string; proof?: string }>;
    artifacts: Record<string, Ref>;
    seq?: number;
    questions?: any[];
    decisions?: any[];
    redirects?: any[];
    verifications?: Record<string, any>;
    invalidations?: any[];
    checks?: any[];
    dispatches?: Dispatch[];
    streak?: { refusals: number; unusable: number };
    /** The dispatch ids and the ledger sizes at the last two stops, so a stop repeats its own records. */
    stopMark?: { from: number; to: number; ledgerFrom?: LedgerCounts; ledgerTo?: LedgerCounts };
    /** The artifact documents, attached on load and dropped on save. */
    docs?: Record<string, Doc>;
}

export interface LedgerCounts { decisions: number; redirects: number; invalidations: number; gates: Record<string, number> }

export interface Dispatch {
    id: number; name: string; agent: string; base: string; message: string; result: string; pass: number;
    resume?: number; openedAt: string; closedAt?: string; outcome?: string; note?: string; gaps?: unknown[];
    report?: string; sha256?: string; cycle?: number; supplemented?: boolean;
}

export interface GuardContext { run: Run; runPath?: string; root: string; docs: Record<string, Doc>; active: Set<string> }
export type Guard = (doc: Doc, ctx: GuardContext) => string[];

export interface ArtifactSpec {
    /** `over` rewrites `<name>.stored.json`; `versioned` writes the next unused `<name>.<K>.json`. */
    store: 'over' | 'versioned';
    guard?: Guard;
    /** Another artifact that must be stored (or restamped) after this one's last store. */
    requires?: string;
    /** `all`: every active decision is projected; `named`: only the decisions it names must be active. */
    projection?: 'all' | 'named';
}

export interface GateSpec {
    label: string;
    next: string;
    back?: string;
    freezes?: string;
    requires?: string[];
    guard?: Guard;
    /** Rejection scopes; `restamp` keeps those artifacts current for the next cycle. */
    scopes?: Record<string, { restamp?: string[] }>;
    summary?: (ctx: { run: Run; runPath: string; active: Set<string> }) => unknown;
}

export interface VerifySpec { phase: string; pass: string; fail: string; checks?: boolean }

export interface Show extends Record<string, any> { runPath: string }

export interface DispatchSpec { agent: string; message: (show: Show, extra: { result?: Doc; text?: string }) => string }

export type Action =
    | { store: string; from: string; onRefusal?: string }
    | { ask: string }
    | { supplement: string }
    | { dispatch: string; fixes: (result: Doc) => string; maxPerCycle: number; park: (result: Doc) => string }
    | { relay: string }
    /** With `checks`, the target verify state's check rows run first, and a failing row refuses the move. */
    | { transition: string; checks?: boolean }
    | { invalidate: true }
    | { park: true }
    | { verify: 'pass' | 'fail'; maxRefusals?: number };

export interface RouteContext { run: Run; runPath: string; pending: any[]; draft: string | null }

export interface LoopConfig {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    initial: string;
    states: Record<string, string[]>;
    artifacts: Record<string, ArtifactSpec>;
    /** A working file beside the run that `show` names and `show --file draft` reads. */
    draft?: string;
    decisionsField?: string;
    obligationsField?: string;
    gates: Record<string, GateSpec>;
    verify: Record<string, VerifySpec>;
    invalidate?: { from: string[]; to: string; proofFrom: string[] };
    revoke?: { phase: string; at: string; to: string };
    checks?: { ignore: string[]; rows: (h: RowsHarness) => void };
    route?: (ctx: RouteContext) => string | undefined;
    routeTransitions?: Record<string, { to: string; onRefusal: string }>;
    byStatus?: Record<string, string>;
    dispatches?: Record<string, DispatchSpec>;
    human?: string[];
    results?: Record<string, Record<string, Action>>;
    resumeSuffix?: string;
    stops?: string[];
    /** `dispatchMinutes` marks a dispatch that ran longer as `slow` in a stop's `since`. */
    limits?: { redispatch: number; unusable: number; dispatchMinutes?: number; failed?: { phase: string; at: string; max: number; note: (show: Show) => string } };
    /** Rows `new` runs before it creates a run; a failing row refuses the run unless the row is a warning. */
    preflight?: (h: RowsHarness) => void;
}

/** Types a loop configuration; returns it unchanged. */
export const defineLoop = (config: LoopConfig): LoopConfig => config;
