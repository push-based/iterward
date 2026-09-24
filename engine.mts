/**
 * looplock engine — the record and the rules of one run of an agentic loop.
 *
 * A loop's configuration (`LoopConfig`) names its states, the artifacts its stages write, its human
 * gates, its verify phases, and how each agent result routes. The engine holds the run file and
 * refuses every move the rules don't allow. It never starts an agent: `next` returns the dispatch a
 * harness sends, and `result` reads the file the agent wrote.
 *
 * Invariants, enforced on every call from the run file alone:
 *   - status moves only along `states`,
 *   - a gate's forward exit needs that gate approved; entering a gate from the initial state needs its
 *     frozen artifact, its required artifacts, no pending question, the decision projection, and its guard,
 *   - a verify state is left only through a verdict (or `blocked`), and a pass needs every obligation of
 *     its phase proven in exactly its evidence mode, plus an all-pass checks record when the phase has checks,
 *   - a blocked run resumes only into the state it blocked from, and a move to blocked needs a note,
 *   - a proof report is cited once: a reused or overwritten report name is refused,
 *   - artifacts live beside the run file with their sha256, and every load refuses a changed file;
 *     a versioned artifact is never overwritten (`<name>.<K>.json`),
 *   - the artifact a gate freezes can't change after approval; only `invalidate` re-opens it,
 *   - human decisions live in an append-only ledger; only a later decision's `supersedes` retires one,
 *   - a result the agent didn't write, or wrote wrong, is re-dispatched a bounded number of times, and a
 *     refused action is re-dispatched with the refusal a bounded number of times, then the run parks.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runChecks, type RowsHarness } from './checks.mts';

export const VERSION = '0.1.0';

/* ------------------------------------------------------------------ types */

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
    stopMark?: { from: number; to: number };
    /** The artifact documents, attached on load and dropped on save. */
    docs?: Record<string, Doc>;
}

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
    | { transition: string }
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
    limits?: { redispatch: number; unusable: number; failed?: { phase: string; at: string; max: number; note: (show: Show) => string } };
}

/** Types a loop configuration; returns it unchanged. */
export const defineLoop = (config: LoopConfig): LoopConfig => config;

/* ------------------------------------------------------------------ helpers */

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v);
const now = (): string => new Date().toISOString();

/** RFC 6901: the value at `pointer` in `doc`, or undefined when it does not resolve. */
export function resolvePointer(doc: Doc, pointer: string): Doc {
    if (pointer === '') return doc;
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
    let cur = doc;
    for (const raw of pointer.slice(1).split('/')) {
        const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
        if (Array.isArray(cur)) {
            if (!/^\d+$/.test(key) || Number(key) >= cur.length) return undefined;
            cur = cur[Number(key)];
        } else if (isObj(cur) && Object.hasOwn(cur, key)) cur = cur[key];
        else return undefined;
    }
    return cur;
}

/** The option key: the leading capital letter of "A. …", "A — …", or "A) …". */
const optionKey = (text: unknown): string | undefined => /^\s*([A-Z])\b/.exec(String(text))?.[1];

/** Ids of decisions no later decision supersedes. */
export function activeDecisionIds(run: Run): Set<string> {
    const superseded = new Set((run.decisions ?? []).map((d) => d.supersedes).filter(Boolean));
    return new Set((run.decisions ?? []).map((d) => d.id).filter((id) => !superseded.has(id)));
}

const retiredIds = (run: Run): Set<string> => new Set((run.redirects ?? []).flatMap((x) => x.retired));

/** Questions that no decision answers and no redirect retired. */
export function pendingQuestions(run: Run): any[] {
    const closed = new Set([...(run.decisions ?? []).map((d) => d.id), ...retiredIds(run)]);
    return (run.questions ?? []).filter((q) => !closed.has(q.id));
}

/** A stored question, as the human sees it. */
export const questionView = ({ id, topic, question, options, recommendation, supersedes }: any) => ({ id, topic, question, options, recommendation, ...(supersedes ? { supersedes } : {}) });

/** A --proof names a report on disk: a verdict or a re-open can't cite a report that was never written. */
export function proofOnDisk(proof: unknown): string | undefined {
    if (proof == null) return undefined;
    if (!existsSync(String(proof))) throw new Error(`proof report not found: ${proof} (record the path the agent returned, after it wrote the report)`);
    return String(proof);
}

/* ------------------------------------------------------------------ the loop */

/** The operations of one loop configuration. */
export function loop(cfg: LoopConfig) {
    const STATUSES = Object.keys(cfg.states);
    const RESUMABLE = new Set(cfg.states.blocked ?? []);
    const DECISIONS = cfg.decisionsField ?? 'decisionsApplied';
    const OBLIGATIONS = cfg.obligationsField ?? 'obligations';
    const freezeGate = Object.keys(cfg.gates).find((g) => cfg.gates[g].freezes);
    const frozen = freezeGate ? cfg.gates[freezeGate].freezes : undefined;
    const limits = { redispatch: 2, unusable: 1, ...cfg.limits };

    const guardCtx = (run: Run, runPath?: string): GuardContext => ({ run, runPath, root: process.cwd(), docs: run.docs ?? {}, active: activeDecisionIds(run) });
    const frozenAfterApproval = (run: Run) => freezeGate != null && run.gates?.[freezeGate]?.decision === 'approved';

    function validateShape(run: Run) {
        if (!isObj(run)) throw new Error('invalid run shape: not an object');
        const bad = [];
        if (!STATUSES.includes(run.status)) bad.push(`status must be one of ${STATUSES.join(', ')}`);
        if (!Array.isArray(run.history)) bad.push('history must be an array');
        for (const k of ['inputs', 'artifacts', 'gates'] as const) if (!isObj(run[k])) bad.push(`${k} must be an object`);
        for (const k of ['questions', 'decisions', 'redirects', 'checks', 'dispatches', 'invalidations'] as const) if (run[k] != null && !Array.isArray(run[k])) bad.push(`${k} must be an array`);
        if (bad.length) throw new Error(`invalid run shape: ${bad.join('; ')}`);
    }

    /** A fresh run at the initial state. `config` is the configuration file's path and sha256. */
    function newRun(inputs: Record<string, unknown>, config?: { path: string; sha256: string }): Run {
        for (const k of cfg.inputs.required) if (!hasText(inputs[k])) throw new Error(`a new run needs --${k}`);
        const declared = [...cfg.inputs.required, ...(cfg.inputs.optional ?? [])];
        const kept = Object.fromEntries(declared.filter((k) => hasText(inputs[k])).map((k) => [k, String(inputs[k])]));
        return { ...(config ? { config } : {}), inputs: kept, status: cfg.initial, gates: {}, artifacts: {}, seq: 0, history: [] };
    }

    function readRef(runPath: string, name: string, ref: Ref): Doc {
        const text = readFileSync(join(dirname(runPath), ref.path), 'utf8');
        if (sha256(text) !== ref.sha256) throw new Error(`${ref.path} changed since store ${name} (sha256 mismatch); only store ${name} (status ${cfg.initial}) writes it`);
        return JSON.parse(text);
    }

    /** Read a run and check its shape; every artifact file is hash-checked and attached as `run.docs`. */
    function loadRun(path: string): Run {
        const run = JSON.parse(readFileSync(path, 'utf8'));
        validateShape(run);
        run.docs = Object.fromEntries(Object.entries(run.artifacts as Record<string, Ref>).map(([name, ref]) => [name, readRef(path, name, ref)]));
        return run;
    }

    /** Write a run, refusing a change to the frozen artifact after its gate approved it. */
    function saveRun(path: string, run: Run): Run {
        validateShape(run);
        const { docs, ...stored } = run;
        if (frozen && existsSync(path)) {
            const prev = JSON.parse(readFileSync(path, 'utf8'));
            if (frozenAfterApproval(prev) && prev.artifacts?.[frozen]?.sha256 !== run.artifacts?.[frozen]?.sha256) {
                throw new Error(`${frozen} is frozen after ${cfg.gates[freezeGate!].label}; only invalidate can re-open it`);
            }
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);
        return run;
    }

    function citedProofs(run: Run): Set<string> {
        return new Set([
            ...Object.values(run.verifications ?? {}).flatMap((v: any) => (v?.attempts ?? []).map((a: any) => a.proof)),
            ...(run.invalidations ?? []).map((i) => i.proof),
            ...(run.history ?? []).map((h) => h.proof),
        ].filter(Boolean));
    }

    function requireFreshProof(run: Run, proof: unknown) {
        if (citedProofs(run).has(String(proof))) throw new Error(`proof ${proof} is already cited by this run; each attempt writes its own report (never reuse or overwrite one)`);
    }

    /** Move along the state graph. A gate's forward exit needs its approval; blocked needs a note. */
    function transition(run: Run, to: string, note?: string, proof?: string): Run {
        const allowed = cfg.states[run.status] ?? [];
        if (!allowed.includes(to)) throw new Error(`illegal transition ${run.status} → ${to} (allowed: ${allowed.join(', ') || 'none'})`);
        const gate = cfg.gates[run.status];
        if (gate && to === gate.next && run.gates?.[run.status]?.decision !== 'approved') {
            throw new Error(`${run.status} → ${to} requires ${gate.label} approval; use gate ${run.status} --decision approved`);
        }
        if (run.status === cfg.initial && cfg.gates[to]) gateReady(run, to);
        if (to === 'blocked' && !hasText(note)) throw new Error('a move to blocked needs a note stating the blockers, so the parked run can explain itself');
        if (to === 'blocked' && proof) requireFreshProof(run, proof);
        if (run.status === 'blocked' && to !== run.blockedFrom) throw new Error(`a blocked run resumes only into ${run.blockedFrom ?? 'its origin'}, not ${to}`);
        if (to === 'blocked' && RESUMABLE.has(run.status)) run.blockedFrom = run.status;
        run.history.push({ from: run.status, to, at: now(), ...(note ? { note } : {}), ...(proof ? { proof: String(proof) } : {}) });
        run.status = to;
        if (to !== 'blocked') delete run.blockedFrom;
        return run;
    }

    /* -------------------------------------------------------------- artifacts */

    /**
     * Store an artifact written at the initial state: refuse it unless its guard and the decision projection
     * accept it, then write it beside the run and record its ref. `dryRun` runs the checks and stores nothing.
     */
    function store(runPath: string, run: Run, name: string, sourcePath: string, { dryRun = false }: { dryRun?: boolean } = {}): Run {
        const spec = cfg.artifacts[name];
        if (!spec) throw new Error(`store takes ${Object.keys(cfg.artifacts).join(', ')}, not ${name}`);
        if (run.status !== cfg.initial) throw new Error(`store ${name} is only allowed at status ${cfg.initial}, not ${run.status}`);
        if (spec.requires) {
            const req = run.artifacts[spec.requires];
            if (!req || req.seq <= (run.artifacts[name]?.seq ?? 0)) throw new Error(`store ${name} needs this cycle's ${spec.requires}: run store ${spec.requires} first`);
        }
        const text = readFileSync(sourcePath, 'utf8');
        const doc = JSON.parse(text);
        const projection = spec.projection ? projectionErrors(run, doc).filter((e) => spec.projection === 'all' || !e.startsWith('active decision')) : [];
        const errs = [...(spec.guard?.(doc, guardCtx(run, runPath)) ?? []), ...projection];
        if (errs.length) throw new Error(`store ${name} refuses the ${name} (${errs.length} error(s)): ${errs.slice(0, 20).join('; ')}`);
        if (dryRun) return run;
        const dir = dirname(runPath);
        const prev = run.artifacts[name];
        let path = `${name}.stored.json`;
        let n = (prev?.n ?? 0) + 1;
        if (spec.store === 'versioned') {
            n = 1;
            while (existsSync(join(dir, `${name}.${n}.json`))) n++;
            path = `${name}.${n}.json`;
        }
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, path), text);
        run.seq = (run.seq ?? 0) + 1;
        run.artifacts[name] = { path, sha256: sha256(text), at: now(), n, seq: run.seq };
        (run.docs ??= {})[name] = doc;
        return run;
    }

    /* -------------------------------------------------------------- decision ledger */

    /** How an artifact projects the ledger: each active decision named with at least one pointer, no unknown or superseded id. */
    function projectionErrors(run: Run, doc: Doc): string[] {
        if (doc == null) return [`the run has no ${frozen ?? 'artifact'}`];
        const errs = [];
        const applied: any[] = Array.isArray(doc[DECISIONS]) ? doc[DECISIONS] : [];
        const recorded = new Set((run.decisions ?? []).map((d) => d.id));
        const active = activeDecisionIds(run);
        for (const a of applied) {
            if (!recorded.has(a?.id)) errs.push(`${DECISIONS} names ${a?.id}, which is not a recorded decision`);
            else if (!active.has(a.id)) errs.push(`${DECISIONS} names ${a.id}, which a later decision superseded`);
        }
        for (const id of active) {
            if (!applied.some((a) => a?.id === id && Array.isArray(a.pointers) && a.pointers.length > 0)) errs.push(`active decision ${id} is not projected (${DECISIONS} needs at least one pointer for it)`);
        }
        return errs;
    }

    /** Store questions as pending and assign their ids (D1, D2, …). The whole list is checked first. */
    function askQuestions(run: Run, questions: any[]): any[] {
        if (run.status !== cfg.initial) throw new Error(`ask is only allowed at status ${cfg.initial}, not ${run.status}`);
        if (!Array.isArray(questions) || questions.length === 0) throw new Error('ask needs a non-empty questions[]');
        const active = activeDecisionIds(run);
        const pendingText = new Set(pendingQuestions(run).map((q) => q.question));
        const resolvedText = new Map((run.decisions ?? []).filter((d) => active.has(d.id)).map((d) => [d.question, d.id]));
        const checked = questions.map((q, i) => {
            const where = `question ${i + 1}`;
            if (!hasText(q?.question)) throw new Error(`${where}: needs the question text`);
            const keys = (q.options ?? []).map(optionKey);
            if (keys.length < 2 || keys.some((k: unknown) => !k) || new Set(keys).size !== keys.length) {
                throw new Error(`${where}: needs at least 2 options, each starting with its own capital-letter key ("A. …", "B. …")`);
            }
            if (!hasText(q.recommendation)) throw new Error(`${where}: needs a recommendation`);
            if (q.supersedes != null && !active.has(q.supersedes)) throw new Error(`${where}: supersedes ${q.supersedes}, which is not an active decision`);
            if (pendingText.has(q.question)) throw new Error(`${where}: the same question is already pending; answer it instead of asking it again`);
            if (resolvedText.has(q.question) && q.supersedes !== resolvedText.get(q.question)) throw new Error(`${where}: ${resolvedText.get(q.question)} already resolves this question; re-open it with supersedes: "${resolvedText.get(q.question)}"`);
            return { ...(q.topic ? { topic: String(q.topic) } : {}), question: q.question, options: q.options.map(String), recommendation: q.recommendation, ...(q.supersedes ? { supersedes: q.supersedes } : {}) };
        });
        const askedAt = now();
        let n = (run.questions ?? []).length;
        const stored = checked.map((q) => ({ id: `D${++n}`, ...q, askedAt }));
        (run.questions ??= []).push(...stored);
        return stored;
    }

    /** Record one human resolution: an option key of the stored snapshot, or the human's own text. */
    function answerQuestion(run: Run, { id, option, custom, answer }: { id: string; option?: string; custom?: string; answer?: string }): any {
        if (run.status !== cfg.initial) throw new Error(`answer is only allowed at status ${cfg.initial}, not ${run.status}`);
        const q = (run.questions ?? []).find((x) => x.id === id);
        if (!q) throw new Error(`no question ${id}; ask stores a question before it can be answered`);
        if ((run.decisions ?? []).some((d) => d.id === id)) throw new Error(`${id} is already answered; a new question with supersedes re-opens it`);
        if (retiredIds(run).has(id)) throw new Error(`${id} was retired by a redirect; the revision asks it again under a new id when it still applies`);
        if ((option == null) === (custom == null)) throw new Error('answer takes exactly one of --option <KEY> or --custom "<TEXT>"');
        if (!hasText(answer)) throw new Error('answer needs --answer with the human\'s words, verbatim');
        let chosenText;
        if (option != null) {
            chosenText = q.options.find((o: string) => optionKey(o) === option);
            if (!chosenText) throw new Error(`${option} is not an option of ${id} (${q.options.map(optionKey).join(', ')})`);
        } else {
            if (!hasText(custom)) throw new Error('--custom needs the human\'s resolution text');
            chosenText = custom;
        }
        if (q.supersedes && !activeDecisionIds(run).has(q.supersedes)) throw new Error(`${id} supersedes ${q.supersedes}, which is no longer active`);
        const decision = { id, ...(q.topic ? { topic: q.topic } : {}), question: q.question, options: q.options, recommendation: q.recommendation, answer, chosen: option ?? 'custom', chosenText, ...(q.supersedes ? { supersedes: q.supersedes } : {}), at: now() };
        (run.decisions ??= []).push(decision);
        return decision;
    }

    /** The artifact store counts now, so routing can tell whether anything was stored since. */
    const storeCounts = (run: Run) => Object.fromEntries(Object.entries(run.artifacts).map(([k, r]) => [k, r.n]));

    /** At a question stop the human redirects the draft instead of answering: every pending question retires. */
    function redirectDraft(run: Run, note: string): any {
        if (run.status !== cfg.initial) throw new Error(`redirect is only allowed at status ${cfg.initial}, not ${run.status}; at a gate a rejection carries the note`);
        if (!hasText(note)) throw new Error('redirect needs --note with the human\'s words, verbatim');
        const retired = pendingQuestions(run).map((q) => q.id);
        if (!retired.length) throw new Error('redirect needs pending questions: it redirects the draft at a question stop');
        const rec = { note, retired, refs: storeCounts(run), at: now() };
        (run.redirects ??= []).push(rec);
        return rec;
    }

    /** The questions the latest redirect retired, as stored. */
    function retiredQuestions(run: Run): any[] {
        const ids = new Set(run.redirects?.at(-1)?.retired ?? []);
        return (run.questions ?? []).filter((q) => ids.has(q.id));
    }

    /* -------------------------------------------------------------- gates */

    function gateReady(run: Run, name: string) {
        const g = cfg.gates[name];
        if (!g.freezes) return;
        const doc = run.docs?.[g.freezes];
        if (doc == null) throw new Error(`${g.label} needs a ${g.freezes} (store ${g.freezes})`);
        for (const r of g.requires ?? []) if (!run.artifacts[r]) throw new Error(`${g.label} needs the ${r} (store ${r})`);
        const pending = pendingQuestions(run);
        if (pending.length) throw new Error(`${g.label} needs every question answered; pending: ${pending.map((q) => q.id).join(', ')}`);
        const errs = [...projectionErrors(run, doc), ...(g.guard?.(doc, guardCtx(run)) ?? [])];
        if (errs.length) throw new Error(`${g.label} refuses the ${g.freezes}: ${errs.join('; ')}`);
    }

    function gateOf(run: Run, name: string): GateSpec {
        const g = cfg.gates[name];
        if (!g) throw new Error(`gate takes ${Object.keys(cfg.gates).join(', ')}, not ${name}`);
        if (run.status !== name) throw new Error(`gate ${name} needs status ${name}, not ${run.status}`);
        return g;
    }

    function recordGate(run: Run, name: string, decision: string, note?: string, extra: Record<string, unknown> = {}) {
        const g = cfg.gates[name];
        const at = now();
        const judged = g.freezes ? run.artifacts[g.freezes] : undefined;
        const history = [...(run.gates[name]?.history ?? []), { ...(judged ? { judged } : {}), decision, ...(note ? { note } : {}), ...extra, at }];
        run.gates[name] = { decision, answeredAt: at, ...(note ? { note } : {}), ...extra, history };
    }

    /**
     * Approve a gate: freezes its artifact and moves on. The preconditions are re-read at the freeze. The
     * approval records each phase's attempt count, so failures count from it in order, not by clock.
     */
    function approve(run: Run, name: string, note?: string): Run {
        const g = gateOf(run, name);
        gateReady(run, name);
        recordGate(run, name, 'approved', note, { attempts: Object.fromEntries(Object.entries(run.verifications ?? {}).map(([k, v]) => [k, (v.attempts ?? []).length])) });
        return transition(run, g.next, `${name} approved`);
    }

    /**
     * Reject a gate with the human's words and a scope. A scope's `restamp` keeps those artifacts current
     * for the next cycle. `supersedes` records the words as the decision that supersedes that active one.
     */
    function reject(run: Run, name: string, note: string | undefined, { supersedes, scope }: { supersedes?: string; scope?: string } = {}): Run {
        const g = gateOf(run, name);
        if (!hasText(note)) throw new Error(`a ${g.label} rejection needs --note with the human's words, verbatim`);
        const scopes = Object.keys(g.scopes ?? {});
        if (scopes.length && !scopes.includes(scope as string)) throw new Error(`a ${g.label} rejection needs --scope ${scopes.join('|')}: the human's one word for what it challenges`);
        const restamp = (scope && g.scopes?.[scope]?.restamp) || [];
        for (const a of restamp) if (!run.artifacts[a]) throw new Error(`a ${scope} rejection needs a stored ${a} to carry into the new cycle`);
        let recorded;
        if (supersedes != null) {
            if (!activeDecisionIds(run).has(supersedes)) throw new Error(`--supersedes ${supersedes} is not an active decision (decisions lists them)`);
            recorded = `D${(run.questions ?? []).length + 1}`;
            const at = now();
            const question = `${g.label} rejected ${g.freezes ? run.artifacts[g.freezes]?.path ?? `the ${g.freezes}` : 'the run'}; the rejection changes ${supersedes}.`;
            const topic = `${g.label} rejection`;
            (run.questions ??= []).push({ id: recorded, topic, question, options: [], recommendation: null, supersedes, askedAt: at });
            (run.decisions ??= []).push({ id: recorded, topic, question, options: [], recommendation: null, answer: note, chosen: 'custom', chosenText: note, supersedes, at });
        }
        recordGate(run, name, 'rejected', note, { ...(scope ? { scope } : {}), ...(recorded ? { supersedes, recorded } : {}) });
        for (const a of restamp) run.artifacts[a].seq = run.seq = (run.seq ?? 0) + 1;
        return transition(run, g.back ?? cfg.initial, `${name} rejected`);
    }

    /* -------------------------------------------------------------- verification */

    const attemptOf = (run: Run, phase: string) => (run.verifications?.[phase]?.attempts ?? []).length + 1;

    function appendAttempt(run: Run, phase: string, rec: Record<string, unknown>) {
        const v = (run.verifications ??= {});
        v[phase] = { ...rec, attempts: [...(v[phase]?.attempts ?? []), rec] };
    }

    /**
     * Record a verdict and route on it: the only way out of a verify state besides blocked. `obligations`
     * maps each obligation id the verifier proved to its evidence mode; modes aren't ranked.
     */
    function recordVerification(run: Run, phase: string, verdict: string, proof: unknown, obligations: Record<string, string> = {}): Run {
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
        }
        if (verdict === 'pass') {
            const list: any[] = (frozen && run.docs?.[frozen]?.[OBLIGATIONS]) ?? [];
            const unmet = list.filter((o) => o?.phase === phase && obligations[o.id] !== o.tier);
            if (unmet.length) throw new Error(`a ${phase} pass needs proof of every ${phase} obligation in its evidence mode; unmet: ${unmet.map((o) => `${o.id} (${o.tier})`).join(', ')}`);
        }
        appendAttempt(run, phase, { verdict, at: now(), proof: String(proof), ...(Object.keys(obligations).length ? { obligations } : {}) });
        const to = verdict === 'pass' ? spec.pass : spec.fail;
        run.history.push({ from: run.status, to, at: now(), note: `${at} ${verdict}` });
        run.status = to;
        delete run.blockedFrom;
        return run;
    }

    /** A human rejects a recorded pass before the next phase starts; the revoked attempt counts as failed. */
    function revokeVerification(run: Run, phase: string, note: string | undefined, proof: unknown): Run {
        const rv = cfg.revoke;
        if (!rv) throw new Error('this loop has no revoke');
        if (phase !== rv.phase) throw new Error(`revoke covers the ${rv.phase} phase only, not ${phase}`);
        if (run.status !== rv.at) throw new Error(`revoke needs status ${rv.at}, not ${run.status}`);
        if (!hasText(note)) throw new Error('revoke needs a note stating why the pass is rejected');
        if (!hasText(proof)) throw new Error('revoke needs the review file as its proof');
        requireFreshProof(run, proof);
        appendAttempt(run, phase, { verdict: 'revoked', at: now(), proof: String(proof), note });
        run.history.push({ from: run.status, to: rv.to, at: now(), note: `${phase} pass revoked: ${note}` });
        run.status = rv.to;
        return run;
    }

    /**
     * A fact breaks the approved artifact: the only path that re-opens it. Clears the gate's approval and
     * returns the run to the initial state; `reason`, `refs`, and the verifier's report are kept.
     */
    function invalidate(run: Run, { reason, refs, proof }: { reason?: string; refs?: string[]; proof?: string } = {}): Run {
        const inv = cfg.invalidate;
        if (!inv) throw new Error('this loop has no invalidate');
        const from = run.status;
        const origin = from === 'blocked' ? run.blockedFrom : from;
        if (!inv.from.includes(origin as string)) throw new Error(`invalidate needs one of ${inv.from.join(', ')}, not ${from}${from === 'blocked' ? ` (blocked from ${origin})` : ''}`);
        if (!hasText(reason)) throw new Error('invalidate needs a reason');
        if (inv.proofFrom.includes(origin as string) && !hasText(proof)) throw new Error('an invalidation from a verify phase requires its proof report (--proof)');
        const retired = frozen ? run.artifacts[frozen] : undefined;
        // `seq` orders the invalidation among the stores, so routing can tell whether an artifact was stored since.
        (run.invalidations ??= []).push({ ...(retired ? { retired } : {}), reason, refs: refs ?? [], ...(proof ? { proof: String(proof) } : {}), at: now(), seq: run.seq ?? 0, from });
        if (freezeGate) run.gates[freezeGate] = { history: run.gates[freezeGate]?.history ?? [] };
        run.history.push({ from, to: inv.to, at: now(), note: `invalidated: ${reason}` });
        run.status = inv.to;
        delete run.blockedFrom;
        return run;
    }

    /* -------------------------------------------------------------- checks */

    /** Run the loop's check rows for the current attempt of the verify phase and record them. */
    function checks(runPath: string, run: Run): any {
        const spec = cfg.verify[run.status];
        if (!spec?.checks || !cfg.checks) throw new Error(`checks run only at status ${Object.keys(cfg.verify).filter((s) => cfg.verify[s].checks).join(', ')}, not ${run.status}`);
        const attempt = attemptOf(run, spec.phase);
        const k = (run.checks ?? []).filter((x) => x.phase === spec.phase && x.attempt === attempt).length + 1;
        const stem = k === 1 ? `checks.${attempt}` : `checks.${attempt}-${k}`;
        const res = runChecks(runPath, { root: process.cwd(), stem, ignore: cfg.checks.ignore, rows: cfg.checks.rows, doc: frozen ? run.docs?.[frozen] : undefined });
        (run.checks ??= []).push({ phase: spec.phase, attempt, path: `${stem}.json`, pass: res.pass, failed: res.failed, blocked: res.blocked, at: now() });
        return { attempt, ...res };
    }

    /** Record a checks run for an attempt (the specs use it to stand in for a real run). */
    function recordChecks(run: Run, rec: Record<string, unknown>): Run {
        (run.checks ??= []).push({ phase: Object.values(cfg.verify).find((v) => v.checks)?.phase, ...rec, at: now() });
        return run;
    }

    /* -------------------------------------------------------------- show */

    const draftPath = (runPath: string) => (cfg.draft ? join(dirname(runPath), cfg.draft) : null);

    const routeCtx = (runPath: string, run: Run): RouteContext => {
        const d = draftPath(runPath);
        return { run, runPath, pending: pendingQuestions(run), draft: d && existsSync(d) ? d : null };
    };

    /** Verify attempts that failed or were revoked since the current approval of the freezing gate. */
    function failedSince(run: Run, phase: string): number {
        const g = freezeGate ? run.gates[freezeGate] : undefined;
        const from = g?.decision === 'approved' ? g.attempts?.[phase] ?? 0 : 0;
        return (run.verifications?.[phase]?.attempts ?? []).slice(from).filter((t: any) => t.verdict === 'fail' || t.verdict === 'revoked').length;
    }

    /** A compact summary of the run; artifact files are named by path, so an agent reads a field, never the run. */
    function show(runPath: string, run: Run): Show {
        const beside = (ref?: Ref) => (ref?.path ? join(dirname(runPath), ref.path) : null);
        const draft = draftPath(runPath);
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
            ...(run.status === cfg.initial && cfg.route ? { next: cfg.route(routeCtx(runPath, run)) } : {}),
            ...Object.fromEntries(Object.keys(cfg.artifacts).map((k) => [k, beside(run.artifacts[k])])),
            ...(cfg.draft ? { draft: draft && existsSync(draft) ? draft : null } : {}),
            ...(run.status === cfg.initial && notes.length ? { notes } : {}),
            ledger: { active: activeDecisionIds(run).size, pending: pendingQuestions(run).length },
            gates: Object.fromEntries(Object.entries(run.gates).filter(([, x]) => x.decision).map(([k, x]) => [k, { decision: x.decision, note: x.note, answeredAt: x.answeredAt }])),
            ...(run.redirects?.length ? { lastRedirect: { note: run.redirects.at(-1).note, retired: run.redirects.at(-1).retired, at: run.redirects.at(-1).at } } : {}),
            ...(rejected ? { lastRejection: { candidate: beside(rejected.judged), note: rejected.note, scope: rejected.scope, ...(rejected.recorded ? { recorded: rejected.recorded, supersedes: rejected.supersedes } : {}) } } : {}),
            ...(run.verifications ? { verifications: Object.fromEntries(Object.entries(run.verifications).map(([k, v]: [string, any]) => [k, { verdict: v.verdict, proof: v.proof, at: v.at, attempts: (v.attempts ?? []).length, failed: failedSince(run, k) }])) } : {}),
            ...(parked ? { blocked: { reason: parked.note, ...(parked.proof ? { proof: parked.proof } : {}), at: parked.at } } : {}),
            ...(inv ? { lastInvalidation: { reason: inv.reason, refs: inv.refs ?? [], ...(inv.proof ? { proof: inv.proof } : {}), from: inv.from, at: inv.at, retired: beside(inv.retired) } } : {}),
        };
    }

    /**
     * One field of an artifact file or the draft: an RFC 6901 `pointer`, and optionally `fields` (each item
     * of a list, or the object, cut to those keys) or `keys` (an object's keys, a list's length).
     */
    function pick(runPath: string, run: Run, { file, pointer = '', fields, keys }: { file: string; pointer?: string; fields?: string; keys?: boolean }) {
        const names = [...Object.keys(cfg.artifacts), ...(cfg.draft ? ['draft'] : [])];
        if (!names.includes(file)) throw new Error(`--file is ${names.join(', ')}, not ${file}`);
        const path = file === 'draft' ? draftPath(runPath) : run.artifacts[file] && join(dirname(runPath), run.artifacts[file].path);
        if (!path || !existsSync(path)) throw new Error(`the run has no ${file} file yet`);
        let value = resolvePointer(JSON.parse(readFileSync(path, 'utf8')), pointer);
        if (value === undefined) throw new Error(`${pointer} does not resolve in ${path}`);
        if (fields) {
            const ks = fields.split(',');
            const cutTo = (x: any) => (isObj(x) ? Object.fromEntries(ks.filter((k) => k in x).map((k) => [k, x[k]])) : x);
            value = Array.isArray(value) ? value.map(cutTo) : cutTo(value);
        }
        if (keys) value = Array.isArray(value) ? { length: value.length } : isObj(value) ? Object.keys(value) : value;
        return { file: path, pointer, value };
    }

    /** The summary of a gate (the first gate with one, unless named). */
    function summary(runPath: string, run: Run, name?: string): unknown {
        const gate = name ?? Object.keys(cfg.gates).find((g) => cfg.gates[g].summary);
        const fn = gate ? cfg.gates[gate]?.summary : undefined;
        if (!fn) throw new Error(`no gate summary${name ? ` for ${name}` : ''}`);
        return fn({ run, runPath, active: activeDecisionIds(run) });
    }

    /* -------------------------------------------------------------- next, result, dispatch */

    const openDispatch = (run: Run) => {
        const d = run.dispatches?.at(-1);
        return d && !d.closedAt ? d : undefined;
    };
    const dispatchOut = (d: Dispatch) => ({ do: 'dispatch', id: d.id, agent: d.agent, message: d.message });
    const streak = (run: Run) => (run.streak ??= { refusals: 0, unusable: 0 });

    /** Open a dispatch: its message, then any Fixes, then the result path. A stale file at that path is removed. */
    function open(runPath: string, run: Run, name: string, o: { base?: string; fixes?: string; pass?: number; resume?: number; extra?: { result?: Doc; text?: string } } = {}) {
        const spec = cfg.dispatches?.[name];
        if (!spec) throw new Error(`the loop has no dispatch ${name}`);
        const id = (run.dispatches ?? []).length + 1;
        const base = o.base ?? spec.message(show(runPath, run), o.extra ?? {});
        const result = join(dirname(runPath), 'results', `${id}.json`);
        mkdirSync(dirname(result), { recursive: true });
        rmSync(result, { force: true });
        const message = `${base}${o.fixes ? ` Fixes: ${o.fixes}` : ''} Result: ${result}.`;
        const d: Dispatch = { id, name, agent: spec.agent, base, message, result, pass: o.pass ?? id, ...(o.resume ? { resume: o.resume } : {}), openedAt: now() };
        (run.dispatches ??= []).push(d);
        return dispatchOut(d);
    }

    /** A stop, with the dispatch records since the previous stop. Repeating the same stop repeats its records. */
    function stop(run: Run, body: Record<string, unknown>) {
        const n = (run.dispatches ?? []).length;
        const m = run.stopMark ?? { from: 0, to: 0 };
        if (m.to !== n) run.stopMark = { from: m.to, to: n };
        const { from, to } = run.stopMark ?? m;
        const since = (run.dispatches ?? []).slice(from, to).map((d) => ({ id: d.id, agent: d.agent, outcome: d.outcome, ...(d.note ? { note: d.note } : {}), ...(d.report ? { report: d.report } : {}), ...(d.gaps?.length ? { gaps: d.gaps } : {}) }));
        return { do: 'stop', ...body, since };
    }

    function park(run: Run, note: string, proof?: string) {
        transition(run, 'blocked', note, proof && existsSync(proof) && !citedProofs(run).has(proof) ? proof : undefined);
    }

    /** The move the run needs now: an open dispatch, a new one, or a stop for the human. */
    function next(runPath: string, run: Run): any {
        const o = openDispatch(run);
        if (o) return dispatchOut(o);
        const s = run.status;
        if (s === 'blocked') {
            const parked = run.history.findLast((h) => h.to === 'blocked');
            return stop(run, { stop: 'blocked', reason: parked?.note, ...(parked?.proof ? { proof: parked.proof } : {}), blockedFrom: run.blockedFrom });
        }
        if (s === cfg.initial) {
            const pending = pendingQuestions(run);
            if (pending.length) {
                const last = (run.dispatches ?? []).findLast((d) => d.closedAt);
                return stop(run, { stop: 'questions', questions: pending.map(questionView), gaps: last?.gaps ?? [] });
            }
            const route = cfg.route?.(routeCtx(runPath, run));
            const t = route ? cfg.routeTransitions?.[route] : undefined;
            if (t) {
                try {
                    transition(run, t.to);
                } catch (e) {
                    return refused(runPath, run, (e as Error).message, { name: t.onRefusal });
                }
                streak(run).refusals = 0;
                return next(runPath, run);
            }
            if (!route || !cfg.dispatches?.[route]) throw new Error(`the loop has no dispatch for route ${route}`);
            return open(runPath, run, route);
        }
        if (cfg.stops?.includes(s)) return stop(run, { stop: 'status', status: s });
        if (cfg.gates[s]) return stop(run, { stop: 'gate', gate: s, ...(cfg.gates[s].summary ? { summary: summary(runPath, run, s) } : {}) });
        const lim = limits.failed;
        if (lim && s === lim.at && failedSince(run, lim.phase) >= lim.max) {
            park(run, lim.note(show(runPath, run)));
            return next(runPath, run);
        }
        const d = cfg.byStatus?.[s];
        if (d) return open(runPath, run, d);
        return stop(run, { stop: 'status', status: s });
    }

    /** A refused action: re-dispatch with the refusal as Fixes, and park past the limit. */
    function refused(runPath: string, run: Run, message: string, { name, source, limit }: { name?: string; source?: Dispatch; limit?: number }) {
        const st = streak(run);
        st.refusals += 1;
        if (st.refusals > (limit ?? limits.redispatch)) {
            st.refusals = 0;
            park(run, message);
            return next(runPath, run);
        }
        if (name) return open(runPath, run, name, { fixes: message, pass: source?.pass });
        return open(runPath, run, source!.name, { base: source!.base, fixes: message, pass: source!.pass, resume: source!.resume });
    }

    /** The result field an action needs. */
    const needs = (a: Action): string | undefined => {
        if ('store' in a) return a.from;
        if ('ask' in a) return a.ask;
        if ('supplement' in a) return 'requests';
        if ('dispatch' in a) return 'reason';
        if ('relay' in a) return a.relay;
        if ('invalidate' in a) return 'reason';
        if ('park' in a) return 'blockers';
        if ('verify' in a) return 'report';
        return undefined;
    };

    function close(run: Run, d: Dispatch, outcome: string, r?: Doc, note?: string) {
        Object.assign(d, { closedAt: now(), outcome, ...(note ? { note } : {}), ...(Array.isArray(r?.gaps) && r.gaps.length ? { gaps: r.gaps } : {}), ...(hasText(r?.report) ? { report: r.report } : {}), cycle: frozen ? run.artifacts[frozen]?.n ?? 0 : 0 });
    }

    /** Read the open dispatch's result file and apply the loop's action for its agent and status. */
    function result(runPath: string, run: Run): any {
        const d = openDispatch(run);
        if (!d) throw new Error('no open dispatch: run next first');
        const actions = cfg.results?.[d.agent] ?? {};
        let r: Doc;
        let text = '';
        let err: string | undefined;
        if (!existsSync(d.result)) err = `no result file at ${d.result}; write the result JSON there before you reply`;
        else {
            text = readFileSync(d.result, 'utf8');
            try {
                r = JSON.parse(text);
            } catch (e) {
                err = `the result file is not JSON: ${(e as Error).message}`;
            }
            if (!err && (!isObj(r) || !hasText(r.status) || !Object.hasOwn(actions, r.status))) err = `the result status must be one of ${Object.keys(actions).join(', ')}, not ${r?.status}`;
            const field = err ? undefined : needs(actions[r.status]);
            if (!err && field && (r[field] == null || r[field] === '' || (Array.isArray(r[field]) && !r[field].length))) err = `a ${r.status} result needs ${field}`;
        }
        const st = streak(run);
        if (err) {
            close(run, d, 'unusable', undefined, err);
            st.unusable += 1;
            if (st.unusable > limits.unusable) {
                st.unusable = 0;
                park(run, `${d.agent} returned no usable result twice: ${err}`);
                return next(runPath, run);
            }
            return open(runPath, run, d.name, { base: d.base, fixes: err, pass: d.pass, resume: d.resume });
        }
        st.unusable = 0;
        d.sha256 = sha256(text);
        const a = actions[r.status];
        try {
            const out = apply(runPath, run, d, a, r);
            st.refusals = 0;
            return out;
        } catch (e) {
            if (!d.closedAt) close(run, d, r.status, r, `refused: ${(e as Error).message}`);
            return refused(runPath, run, (e as Error).message, { name: 'store' in a ? a.onRefusal : undefined, source: d, limit: 'verify' in a ? a.maxRefusals : undefined });
        }
    }

    function apply(runPath: string, run: Run, d: Dispatch, a: Action, r: Doc): any {
        if ('store' in a) {
            store(runPath, run, a.store, String(r[a.from]));
            close(run, d, r.status, r);
            if (d.resume) {
                const origin = run.dispatches!.find((x) => x.id === d.resume)!;
                return open(runPath, run, origin.name, { base: `${origin.base}${cfg.resumeSuffix ?? ''}`, pass: origin.pass });
            }
            return next(runPath, run);
        }
        if ('ask' in a) {
            const doc = JSON.parse(readFileSync(String(r[a.ask]), 'utf8'));
            askQuestions(run, Array.isArray(doc) ? doc : doc.questions);
            close(run, d, r.status, r);
            return next(runPath, run);
        }
        if ('supplement' in a) {
            const again = run.dispatches!.some((x) => x.pass === d.pass && x.supplemented);
            close(run, d, r.status, r);
            if (again) {
                park(run, `${d.agent} returned ${r.status} twice in one pass: ${JSON.stringify(r.requests)}`);
                return next(runPath, run);
            }
            d.supplemented = true;
            return open(runPath, run, a.supplement, { extra: { result: r }, pass: d.pass, resume: d.id });
        }
        if ('dispatch' in a) {
            close(run, d, r.status, r);
            const count = run.dispatches!.filter((x) => x.agent === d.agent && x.outcome === r.status && x.cycle === d.cycle).length;
            if (count > a.maxPerCycle) {
                park(run, a.park(r));
                return next(runPath, run);
            }
            return open(runPath, run, a.dispatch, { fixes: a.fixes(r) });
        }
        if ('relay' in a) {
            close(run, d, r.status, r);
            return { do: 'relay', answer: r[a.relay] };
        }
        if ('transition' in a) transition(run, a.transition);
        else if ('invalidate' in a) invalidate(run, { reason: r.reason, refs: Array.isArray(r.refs) ? r.refs.map(String) : [], proof: proofOnDisk(r.report) });
        else if ('park' in a) park(run, r.blockers.map((b: any) => `${b?.topic}: ${b?.reason}`).join('; '), r.report);
        else if ('verify' in a) {
            const obligations = Object.fromEntries((Array.isArray(r.obligations) ? r.obligations : []).map((x: string) => String(x).split(':')));
            recordVerification(run, cfg.verify[run.status]?.phase, a.verify, proofOnDisk(r.report), obligations);
        }
        close(run, d, r.status, r);
        return next(runPath, run);
    }

    /** The human starts a configured route, such as a clarification, with their own words. */
    function dispatchHuman(runPath: string, run: Run, name: string, text: string | undefined) {
        if (!cfg.human?.includes(name)) throw new Error(`dispatch takes ${(cfg.human ?? []).join(', ') || 'no route'}, not ${name}`);
        if (openDispatch(run)) throw new Error('a dispatch is open: run result first');
        if (!hasText(text)) throw new Error('dispatch needs --text with the human\'s words, verbatim');
        return open(runPath, run, name, { extra: { text } });
    }

    return {
        cfg, newRun, loadRun, saveRun, transition, store, projectionErrors, askQuestions, answerQuestion, redirectDraft, retiredQuestions,
        approve, reject, recordVerification, revokeVerification, invalidate, checks, recordChecks, attemptOf, show, pick, summary,
        next, result, dispatchHuman,
    };
}
