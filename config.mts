/**
 * looplock configuration — the shape of a loop file, the hooks a loop names, the run record the hooks read,
 * and the compiled `LoopConfig` the engine runs. A loop is one JSON file (`LoopFile`); `loadLoop` in
 * `load-config.mts` resolves its hooks and compiles it. The engine never parses a consumer's file: it hands
 * every path to a hook.
 */

/** A hook: a named export of an ES module, the module path relative to the loop file. */
export interface HookRef { module: string; export: string }

export interface LoopFile {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    /** A question's file name in the run folder, with {n}, such as "RFC-{n}.md". Questions exist only at the initial state. */
    questions?: string;
    /** Runs on `new`, before the run exists. */
    preflight?: HookRef;
    /** Reads a dispatch's status from the document the dispatch declares. */
    result: HookRef;
    /** Runs at `answer`, before the engine records the answer and freezes the question file. */
    onAnswer?: HookRef;
    /** `file` is a plain file name in the run folder; it can hold {attempt}. */
    artifacts: Record<string, { file: string; guard?: HookRef }>;
    stages: StageDef[];
    /** One validator per state, run on every transition into that state. */
    validators?: Record<string, HookRef>;
    limits?: { redispatch?: number; unusable?: number; dispatchMinutes?: number };
}

/** One stage of a loop. The key that names the kind also names the state; every target a stage leaves out is inferred. */
export type StageDef =
    | { plan: string; route: HookRef; dispatches: Record<string, DispatchDef>; next?: string | string[] }
    | { gate: string; label: string; next?: string; back?: string; freezes?: string[]; summary?: HookRef }
    | { work: string; dispatch: DispatchDef }
    | { verify: string; dispatch: DispatchDef; pass?: string; fail?: string; maxFailed?: number }
    | { stop: string }
    | { end: string };

export interface DispatchDef {
    agent: string;
    /** The artifact whose file the dispatch writes: its document. */
    artifact: string;
    /** A template: {runPath}, {attempt}, {document}, {note}, an input, or a value the route supplies. */
    message: string;
    /** Merged over the stage kind's default outcomes; null removes a default. */
    outcomes?: Record<string, Action | null>;
}

export type Action = { transition: string } | { route: true } | { ask: true } | { park: true };

// ---- Hooks. A hook can return a value or a promise, and the engine awaits it. A hook must not change the run.

export type Awaitable<T> = T | Promise<T>;

export interface HookContext {
    /** The repository root: the working directory of the CLI and the MCP server. */
    root: string;
    /** The run file, as the command received it. */
    runPath: string;
    /** The run folder, the folder of runPath. */
    runDir: string;
    run: Readonly<Run>;
}

export interface DispatchInfo { id: number; name: string; agent: string; attempt: number; document: string; openedAt: string }

/** Runs on `new`. An error refuses the run; each warning is stored in run.json with its reason. */
export type Preflight = (ctx: { root: string; runPath: string; inputs: Record<string, string> }) => Awaitable<{ errors: string[]; warnings: string[] }>;

/** Reads the step's status from the dispatch's document. An error makes the result unusable. */
export type ResultHook = (path: string, ctx: HookContext & { dispatch: DispatchInfo }) => Awaitable<{ status: string } | { error: string }>;

/**
 * An artifact's guard. `event` says why it runs: `validate` (the validate command), `result` (a dispatch's
 * non-park outcome), `enter` (a transition into the gate that freezes the artifact), or `approve` (that gate's
 * approval). It returns error lines; an empty list accepts.
 */
export type Guard = (path: string, ctx: HookContext & { event: 'validate' | 'result' | 'enter' | 'approve'; dispatch?: DispatchInfo; status?: string }) => Awaitable<string[]>;

/** A state's entry validator: runs on every transition into `to`. */
export type Validator = (ctx: HookContext & { from: string; to: string; human: boolean; dispatch?: DispatchInfo }) => Awaitable<string[]>;

/** The plan stage's route: the next dispatch, with values for its message, or the gate to enter. */
export type Route = (ctx: HookContext) => Awaitable<{ dispatch: string; with?: Record<string, string> } | { gate: string; onRefusal: string }>;

/** Writes the human's answer into the question file. A throw refuses the answer and records nothing. */
export type OnAnswer = (ctx: HookContext & { question: { id: string; file: string }; option: string; answer: string }) => Awaitable<void>;

/** Lines the gate stop shows before the human decides. */
export type GateSummary = (ctx: HookContext & { gate: string }) => Awaitable<string[]>;

// ---- The run record: run.json, which the engine writes.

export interface Run {
    config: { path: string; sha256: string };
    inputs: Record<string, string>;
    status: string;
    blockedFrom?: string;
    /** Preflight warnings, each with its reason. */
    warnings: string[];
    gates: Record<string, { decision?: 'approved' | 'rejected'; note?: string; at?: string; history: GateEntry[] }>;
    /** `human` marks a move a human made: a gate decision or a human transition. */
    history: { from: string; to: string; at: string; note?: string; human?: true }[];
    /** Frozen files by run-relative name; `by` is the gate or the question that froze each. */
    freezes: Record<string, { sha256: string; by: string; at: string }>;
    questions: Question[];
    dispatches: Dispatch[];
    streak: { refusals: number; unusable: number };
    /** The dispatch counts at the last two stops, so a repeated stop repeats itself. */
    stopMark?: { from: number; to: number };
}

export interface GateEntry { decision: 'approved' | 'rejected'; note?: string; at: string; judged: Record<string, string> }

export interface Question { id: string; file: string; status: 'pending' | 'resolved'; chosen?: string; answer?: string; askedAt: string; resolvedAt?: string }

export interface Dispatch {
    id: number; name: string; agent: string; attempt: number; document: string; message: string; openedAt: string;
    with?: Record<string, string>; closedAt?: string; outcome?: string; note?: string;
}

// ---- The compiled loop, which the engine runs.

/** A move a human can make with `transition`; `drops` names the gate whose freeze the move drops. */
export interface HumanEdge { to: string; drops?: string; resets?: true; retries?: true }

export interface GateConfig { label: string; next: string; back: string; freezes: string[]; summary?: GateSummary }

export interface DispatchConfig { agent: string; artifact: string; message: string; outcomes: Record<string, Action> }

export interface Limits {
    redispatch: number;
    unusable: number;
    /** A dispatch that ran longer is `slow` in a stop's `since`. */
    dispatchMinutes?: number;
    /** From a verify stage's `maxFailed`: `max` failed verdicts of `stage` since the last human move into `at` park the run. */
    failed?: { stage: string; at: string; max: number };
}

export interface LoopConfig {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    /** The question file pattern; its one capture group is `{n}`. */
    questions?: RegExp;
    initial: string;
    /** The agent, route, and gate edges of each state, and under `blocked` the states a run can resume. */
    states: Record<string, string[]>;
    /** The human edges of each stage; a blocked run's edges are computed at run time. */
    human: Record<string, HumanEdge[]>;
    gates: Record<string, GateConfig>;
    /** The one gate that declares `freezes`. */
    freezeGate?: string;
    artifacts: Record<string, { file: string; guard?: Guard }>;
    dispatches: Record<string, DispatchConfig>;
    /** Each work and verify state's dispatch. */
    byStatus: Record<string, string>;
    route: Route;
    result: ResultHook;
    onAnswer?: OnAnswer;
    preflight?: Preflight;
    validators: Record<string, Validator>;
    /** The stop and end states. */
    stops: string[];
    limits: Limits;
    /** The HookRef of every hook, by the JSON pointer of its place in this configuration. */
    hooks: Record<string, HookRef>;
    /** The configuration hash, over the loop file and every hook module with its local imports. */
    sha256: string;
}
