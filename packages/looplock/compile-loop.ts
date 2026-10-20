/**
 * The loop compiler: it checks a loop file and turns it into the `LoopConfig` the engine runs. Nothing is
 * inferred: each step declares its outcomes, and `machine` maps each outcome to its target, a `*` key for any
 * step that declares the outcome. A configuration the engine can't run throws here, when it loads, with the
 * place and the field at fault. The engine names no step: the rules read only the compiled values.
 */

import type { HookRef, LoopConfig, LoopFile, StepConfig, Target } from './config.ts';

/** The fields each part of a loop file takes, and the name a refusal gives the part. */
const FIELDS: Record<string, [string, string[]]> = {
    loop: ['a loop file', ['name', 'inputs', 'preflight', 'questions', 'artifacts', 'steps', 'gates', 'stops', 'machine', 'human', 'limits']],
    inputs: ['inputs', ['required', 'optional']],
    questions: ['questions', ['file', 'onAnswer']],
    limits: ['limits', ['opens']],
    artifact: ['an artifact', ['file', 'guard']],
    step: ['a step', ['agent', 'writes', 'outcomes', 'onEnter']],
    gate: ['a gate', ['label', 'freezes', 'onEnter']],
    stop: ['a stop', ['onEnter']],
};
/** Names the engine keeps: a step, gate, or stop can't take one. */
const RESERVED = ['blocked', 'park', 'start'];
/** Names every JavaScript object has, such as `constructor`: a lookup by one would find Object.prototype's member. */
const INHERITED = new Set(Object.getOwnPropertyNames(Object.prototype));
const NAME = /^[\w-]+$/;
const HOOK = /^([^#]+)#([A-Za-z_$][\w$]*)$/;

/** A hook reference's module path and export name. */
export const hookParts = (ref: HookRef) => {
    const [, module, name] = HOOK.exec(ref) ?? [];
    return { module, export: name };
};
const ptr = (...keys: string[]) => keys.map((k) => `/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
/** The keys of a JSON pointer, unescaped. */
export const keysOf = (pointer: string) => pointer.slice(1).split('/').map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'));
/** Sets the value at `pointer`, whose parent exists. */
export function setAt(target: object, pointer: string, value: unknown): void {
    const keys = keysOf(pointer);
    const last = keys.pop()!;
    keys.reduce((o: any, k) => o[k], target)[last] = value;
}
const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v);
/** A question file template as a pattern: `{n}` becomes the one capture group. */
const questionPattern = (template: string) => new RegExp(`^${template.split('{n}').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)')}$`);

/** The configuration as JSON: each hook prints as its HookRef and the question pattern as its source. */
export function printable(config: LoopConfig) {
    const { hooks, ...rest } = config;
    const out = JSON.parse(JSON.stringify(rest, (_, v) => (v instanceof RegExp ? String(v) : v)));
    for (const [pointer, ref] of Object.entries(hooks)) setAt(out, pointer, ref);
    return out;
}

/**
 * Compiles a parsed loop file. Each hook's place stays empty and its HookRef is listed in `hooks` by pointer;
 * `loadLoop` resolves them and computes `sha256`.
 */
export function compileLoop(file: LoopFile): LoopConfig {
    const name = isObj(file) && typeof file.name === 'string' ? file.name : '';
    const fail = (where: string, message: string): never => {
        throw new Error(`loop ${name || '?'}, ${where}: ${message}`);
    };
    const fields = (o: unknown, part: string, where: string): Record<string, any> => {
        const [label, keys] = FIELDS[part];
        if (!isObj(o)) return fail(where || 'loop file', `${label} is an object`);
        for (const k of Object.keys(o)) if (!keys.includes(k)) fail(where ? `${where}, ${k}` : k, `not a field of ${label}`);
        return o;
    };
    const text = (v: unknown, where: string): string => (typeof v === 'string' && v ? v : fail(where, 'must be a nonempty string'));
    const inherited = (n: string, where: string) => {
        if (INHERITED.has(n)) fail(where, `${n} is a name every JavaScript object has`);
    };
    const names = (v: unknown, where: string): string[] => {
        if (!Array.isArray(v) || !v.every((s) => typeof s === 'string' && NAME.test(s))) return fail(where, 'must be a list of names');
        for (const s of v) inherited(s, where);
        return v;
    };
    const hooks: Record<string, HookRef> = {};
    const hook = (ref: unknown, pointer: string, where: string) => {
        if (typeof ref !== 'string' || !HOOK.test(ref)) fail(where, 'a hook is "<file>#<export>", the file relative to the loop file');
        hooks[pointer] = ref as string;
    };

    fields(file, 'loop', '');
    text(file.name, 'name');
    const inputs = fields(file.inputs, 'inputs', 'inputs');
    names(inputs.required, 'inputs.required');
    if (inputs.optional !== undefined) names(inputs.optional, 'inputs.optional');
    if (file.preflight !== undefined) hook(file.preflight, '/preflight', 'preflight');
    let questions: RegExp | undefined;
    if (file.questions !== undefined) {
        const q = fields(file.questions, 'questions', 'questions');
        if (typeof q.file !== 'string' || q.file.split('{n}').length !== 2 || /[/\\]|\.\./.test(q.file)) fail('questions.file', 'a plain file name in the run folder with one {n}, such as "Q-{n}.md"');
        questions = questionPattern(q.file);
        if (q.onAnswer !== undefined) hook(q.onAnswer, '/onAnswer', 'questions.onAnswer');
    }

    // Each artifact's file is a plain file name in the run folder that no other artifact, question, or engine file uses.
    if (!isObj(file.artifacts)) fail('artifacts', 'must map each artifact to its file');
    const artifacts: LoopConfig['artifacts'] = {};
    const files = new Map<string, string>();
    for (const [a, spec] of Object.entries(file.artifacts)) {
        const where = `artifact ${a}`;
        inherited(a, where);
        const f = text(fields(spec, 'artifact', where).file, `${where}, file`);
        if (/[/\\]|\.\./.test(f)) fail(`${where}, file`, `${f} is not a plain file name in the run folder`);
        if (f === 'run.json' || f === 'out') fail(`${where}, file`, `${f} is a name the engine keeps`);
        if (questions?.test(f.replaceAll('{attempt}', '1'))) fail(`${where}, file`, `${f} matches the questions pattern`);
        if (files.has(f)) fail(`${where}, file`, `artifact ${files.get(f)} has the file ${f} already`);
        files.set(f, a);
        artifacts[a] = { file: f };
        if (spec.guard !== undefined) hook(spec.guard, ptr('artifacts', a, 'guard'), `${where}, guard`);
    }

    // One namespace for steps, gates, and stops: a machine target names one of them.
    const kind = new Map<string, 'step' | 'gate' | 'stop'>();
    const block = (v: unknown, k: 'step' | 'gate' | 'stop', where: string): Record<string, Record<string, any>> => {
        if (v === undefined) return {};
        if (!isObj(v)) return fail(where, `must map each ${k} to its definition`);
        for (const [n, def] of Object.entries(v)) {
            const at = `${k} ${n}`;
            if (!NAME.test(n)) fail(at, 'a name takes letters, digits, _, and -');
            inherited(n, at);
            if (RESERVED.includes(n)) fail(at, `${n} is a name the engine keeps`);
            if (kind.has(n)) fail(at, `${kind.get(n)} ${n} has the name already`);
            kind.set(n, k);
            fields(def, k, at);
        }
        return v;
    };
    const stepDefs = block(file.steps, 'step', 'steps');
    const gateDefs = block(file.gates, 'gate', 'gates');
    const stopDefs = block(file.stops, 'stop', 'stops');
    if (!Object.keys(stepDefs).length) fail('steps', 'declare at least one step');

    const steps: Record<string, StepConfig> = {};
    for (const [s, d] of Object.entries(stepDefs)) {
        const at = `step ${s}`;
        const writes = text(d.writes, `${at}, writes`);
        if (!Object.hasOwn(artifacts, writes)) fail(`${at}, writes`, `${writes} is not an artifact`);
        if (file.artifacts[writes].guard === undefined) fail(`${at}, writes`, `artifact ${writes} has no guard, and its guard returns the step's status`);
        const outcomes = names(d.outcomes, `${at}, outcomes`);
        if (!outcomes.length || new Set(outcomes).size !== outcomes.length) fail(`${at}, outcomes`, 'list each outcome once');
        steps[s] = { agent: text(d.agent, `${at}, agent`), writes, outcomes: Object.fromEntries(outcomes.map((o) => [o, ''])) };
        if (d.onEnter !== undefined) hook(d.onEnter, ptr('steps', s, 'onEnter'), `${at}, onEnter`);
    }
    const gates: LoopConfig['gates'] = {};
    const frozenBy = new Map<string, string>();
    for (const [g, d] of Object.entries(gateDefs)) {
        const at = `gate ${g}`;
        const freezes = d.freezes === undefined ? [] : names(d.freezes, `${at}, freezes`);
        for (const a of freezes) {
            if (!Object.hasOwn(artifacts, a)) fail(`${at}, freezes`, `${a} is not an artifact`);
            if (artifacts[a].file.includes('{attempt}')) fail(`${at}, freezes`, `${a} is written per attempt; a freeze holds one file`);
            if (frozenBy.has(a)) fail(`${at}, freezes`, `gate ${frozenBy.get(a)} freezes ${a} already`);
            frozenBy.set(a, g);
        }
        gates[g] = { label: text(d.label, `${at}, label`), freezes, approve: '', reject: '' };
        if (d.onEnter !== undefined) hook(d.onEnter, ptr('gates', g, 'onEnter'), `${at}, onEnter`);
    }
    const stops: LoopConfig['stops'] = {};
    for (const [s, d] of Object.entries(stopDefs)) {
        stops[s] = {};
        if (d.onEnter !== undefined) hook(d.onEnter, ptr('stops', s, 'onEnter'), `stop ${s}, onEnter`);
    }

    // ponytail: JSON.parse keeps the last of two equal keys, so "exactly once" is checked as "at least once, and none undeclared".
    if (!isObj(file.machine)) fail('machine', 'must map "start" and each "<step>.<outcome>" to its target');
    const target = (where: string, t: unknown, decision = false): Target => {
        if (typeof t === 'string' && (kind.has(t) || (t === 'park' && !decision))) return t;
        if (!decision && isObj(t) && Object.keys(t).length === 1 && Object.hasOwn(t, 'ask')) {
            if (!questions) fail(where, 'ask needs the loop\'s questions');
            if (kind.get(t.ask) !== 'step') fail(where, `ask names the step that runs after the answers, and ${t.ask} is not a step`);
            return { ask: t.ask };
        }
        return fail(where, decision ? `a gate decision goes to a step, a gate, or a stop, not ${JSON.stringify(t)}` : `a target is a step, a gate, a stop, park, or { "ask": STEP }, not ${JSON.stringify(t)}`);
    };
    let start: string | undefined;
    const any: Record<string, Target> = {};
    for (const [key, t] of Object.entries(file.machine)) {
        const where = `machine."${key}"`;
        if (key === 'start') {
            if (typeof t !== 'string' || kind.get(t) !== 'step') fail(where, 'start names a step');
            start = t as string;
            continue;
        }
        const dot = key.indexOf('.');
        const [x, o] = dot < 0 ? [key, ''] : [key.slice(0, dot), key.slice(dot + 1)];
        if (x === '*') {
            if (!Object.values(steps).some((s) => Object.hasOwn(s.outcomes, o))) fail(where, `no step declares the outcome ${o}`);
            any[o] = target(where, t);
        } else if (kind.get(x) === 'step') {
            if (!Object.hasOwn(steps[x].outcomes, o)) fail(where, `step ${x} declares no outcome ${o}; its outcomes are ${Object.keys(steps[x].outcomes).join(', ')}`);
            steps[x].outcomes[o] = target(where, t);
        } else if (kind.get(x) === 'gate') {
            if (o !== 'approve' && o !== 'reject') fail(where, 'a gate takes approve and reject');
            gates[x][o as 'approve' | 'reject'] = target(where, t, true) as string;
        } else fail(where, 'a key is "start", "<step>.<outcome>", "*.<outcome>", "<gate>.approve", or "<gate>.reject"');
    }
    if (start === undefined) fail('machine', 'name the first step with "start"');
    for (const [s, step] of Object.entries(steps)) {
        for (const o of Object.keys(step.outcomes)) step.outcomes[o] ||= any[o] ?? fail(`step ${s}, outcomes`, `the machine has no "${s}.${o}" and no "*.${o}"`);
    }
    for (const [g, x] of Object.entries(gates)) for (const k of ['approve', 'reject'] as const) if (!x[k]) fail(`gate ${g}`, `the machine has no "${g}.${k}"`);

    const human: Record<string, string[]> = {};
    if (file.human !== undefined && !isObj(file.human)) fail('human', 'must map each step or stop to the states a human can move it to');
    for (const [s, tos] of Object.entries(file.human ?? {})) {
        const k = kind.get(s);
        if (k !== 'step' && k !== 'stop') fail(`human.${s}`, `${s} is not a step or a stop; a gate's moves are its decisions`);
        human[s] = names(tos, `human.${s}`);
        for (const t of human[s]) if (!kind.has(t)) fail(`human.${s}`, `${t} is not a step, gate, or stop of the loop`);
    }

    const limits = file.limits === undefined ? {} : fields(file.limits, 'limits', 'limits');
    if (limits.opens !== undefined && (!Number.isInteger(limits.opens) || limits.opens < 1)) fail('limits.opens', 'must be a whole number from 1');

    // ponytail: the hook places (guards, onEnter, ...) stay empty until `loadLoop` fills them from `hooks`.
    return {
        name,
        inputs: { required: inputs.required, ...(inputs.optional ? { optional: inputs.optional } : {}) },
        ...(questions ? { questions } : {}),
        start: start!,
        artifacts,
        steps,
        gates,
        stops,
        human,
        limits: { opens: limits.opens ?? 3 },
        hooks,
        sha256: '',
    };
}
