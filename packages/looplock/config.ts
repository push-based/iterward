/**
 * looplock configuration — the shape of a loop file, the hooks a loop names, the run record the hooks read,
 * and the compiled `LoopConfig` the engine runs. A loop is one JSON file (`LoopFile`); `loadLoop` in
 * `load-config.ts` resolves its hooks and compiles it. The engine never parses a consumer's file: it hands
 * every path to a hook.
 */

/** A hook: `"<file>#<export>"`, a named export of an ES module, the file relative to the loop file. */
export type HookRef = string;

/** Where an outcome leads: a step, a gate, a stop, `park`, or the questions and then a step. */
export type Target = string | { ask: string };

export interface LoopFile {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    /** Runs on `new`, before the run exists. */
    preflight?: HookRef;
    /** `file` is a question's file name in the run folder, with {n}, such as "Q-{n}.md". `onAnswer` runs at `answer`, once for each answer of the call. */
    questions?: { file: string; onAnswer?: HookRef };
    /** `file` is a plain file name in the run folder; it can hold {attempt}. The guard belongs to the document. */
    artifacts: Record<string, { file: string; guard?: HookRef }>;
    /** Each step: the agent it opens, the artifact it writes, the statuses its guard can return, and its entry check. */
    steps: Record<string, { agent: string; writes: string; outcomes: string[]; onEnter?: HookRef }>;
    /** Each gate: its label, the artifacts its approval freezes, and its entry check. */
    gates?: Record<string, { label: string; freezes?: string[]; onEnter?: HookRef }>;
    /** Each state where the run waits for a human with no agent to open. */
    stops?: Record<string, { onEnter?: HookRef }>;
    /** `"start"`, and `"<step>.<outcome>"`, `"*.<outcome>"`, `"<gate>.approve"`, or `"<gate>.reject"`, each to its target. */
    machine: Record<string, Target>;
    /** The states a human can move each step or stop to with `transition`. */
    human?: Record<string, string[]>;
    /** `opens`: how many times a step opens since the last human move before the run parks; 3 when left out. */
    limits?: { opens?: number };
}

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

/**
 * An artifact's guard. `event` says why it runs: `result` (the step that writes it closed), `enter` (a transition
 * into the gate that freezes it), `approve` (that gate's approval), or `validate` (the validate command). It
 * returns the document's status, which `machine` follows on `result`, or the error lines that refuse it.
 */
export type Guard = (path: string, ctx: HookContext & { event: 'validate' | 'result' | 'enter' | 'approve'; dispatch?: DispatchInfo }) => Awaitable<{ status: string } | { errors: string[] }>;

/** A step's, gate's, or stop's entry check: runs on every transition into it, from an outcome or a human move. */
export type OnEnter = (ctx: HookContext & { from: string; to: string; human: boolean; dispatch?: DispatchInfo }) => Awaitable<string[]>;

/**
 * Writes the human's answer into the question file. A throw refuses the whole `answer` call, and the run records
 * none of its answers. The engine doesn't undo what the hook wrote for the call's earlier answers.
 */
export type OnAnswer = (ctx: HookContext & { question: { id: string; file: string }; option: string; answer: string }) => Awaitable<void>;

// ---- The run record: run.json, which the engine writes.

export interface Run {
    config: { path: string; sha256: string };
    /** The Looplock version that started the run. An engine of another minor version, or major version from 1.0, refuses the run. */
    engine: string;
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
}

export interface GateEntry { decision: 'approved' | 'rejected'; note?: string; at: string; judged: Record<string, string> }

export interface Question { id: string; file: string; status: 'pending' | 'resolved'; chosen?: string; answer?: string; askedAt: string; resolvedAt?: string }

/** `outcome` is the guard's status, `refused`, or `unusable`; `fixes` are the lines the step's next open must fix. */
export interface Dispatch {
    id: number; name: string; agent: string; attempt: number; document: string; message: string; openedAt: string;
    closedAt?: string; outcome?: string; fixes?: string[];
}

// ---- The compiled loop, which the engine runs.

/** A step with each outcome's target resolved from `machine`, a `*` key included. */
export interface StepConfig { agent: string; writes: string; outcomes: Record<string, Target>; onEnter?: OnEnter }

export interface GateConfig { label: string; freezes: string[]; approve: string; reject: string; onEnter?: OnEnter }

export interface LoopConfig {
    name: string;
    inputs: { required: string[]; optional?: string[] };
    /** The question file pattern; its one capture group is `{n}`. */
    questions?: RegExp;
    onAnswer?: OnAnswer;
    preflight?: Preflight;
    /** The first step. */
    start: string;
    artifacts: Record<string, { file: string; guard?: Guard }>;
    steps: Record<string, StepConfig>;
    gates: Record<string, GateConfig>;
    stops: Record<string, { onEnter?: OnEnter }>;
    human: Record<string, string[]>;
    limits: { opens: number };
    /** The HookRef of every hook, by the JSON pointer of its place in this configuration. */
    hooks: Record<string, HookRef>;
    /** The configuration hash, over the loop file and every hook module with its local imports. */
    sha256: string;
}
