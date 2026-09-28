/**
 * The stage compiler: it turns a loop file's ordered stages into the `LoopConfig` the engine runs. The stage
 * order supplies every target a stage leaves out, and the stage kind supplies the standard outcomes of work and
 * verify dispatches and the human edges of every stage. An explicit value always wins, and every value the
 * compiler supplies is recorded as a JSON pointer, which `looplock compile` prints. A configuration the engine
 * can't run throws here, when it loads, with the stage or the artifact and the field at fault. The engine names
 * no stage: the rules read only kinds, order, and the compiled values.
 */

import type { Action, DispatchConfig, GateConfig, HookRef, HumanEdge, LoopConfig, LoopFile } from './config.mts';

const KINDS = ['plan', 'gate', 'work', 'verify', 'stop', 'end'] as const;
const ACTIONS = ['transition', 'route', 'ask', 'park'];
/** The fields each part of a loop file takes, and the name a refusal gives the part. */
const FIELDS: Record<string, [string, string[]]> = {
    loop: ['a loop file', ['name', 'inputs', 'questions', 'preflight', 'result', 'onAnswer', 'artifacts', 'stages', 'validators', 'limits']],
    inputs: ['inputs', ['required', 'optional']],
    limits: ['limits', ['redispatch', 'unusable']],
    artifact: ['an artifact', ['file', 'guard']],
    hook: ['a hook', ['module', 'export']],
    dispatch: ['a dispatch', ['agent', 'artifact', 'message', 'outcomes']],
    plan: ['a plan stage', ['plan', 'route', 'dispatches', 'next']],
    gate: ['a gate stage', ['gate', 'label', 'next', 'back', 'freezes']],
    work: ['a work stage', ['work', 'dispatch']],
    verify: ['a verify stage', ['verify', 'dispatch', 'pass', 'fail', 'maxFailed']],
    stop: ['a stop stage', ['stop']],
    end: ['an end stage', ['end']],
};
/** The placeholders the engine fills in every dispatch message, besides the inputs. */
const FIXED = ['runPath', 'attempt', 'document', 'note'];

/** The inferred pointers of each configuration `compileLoop` built. */
const INFERRED = new WeakMap<LoopConfig, string[]>();
export const inferredOf = (config: LoopConfig): string[] => INFERRED.get(config) ?? [];

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
export function compileLoop(file: LoopFile): { config: LoopConfig; inferred: string[] } {
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
    const names = (v: unknown, where: string): string[] => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : fail(where, 'must be a list of names'));
    const hooks: Record<string, HookRef> = {};
    const hook = (ref: unknown, pointer: string, where: string) => {
        const r = fields(ref, 'hook', where);
        hooks[pointer] = { module: text(r.module, `${where}.module`), export: text(r.export, `${where}.export`) };
    };

    fields(file, 'loop', '');
    text(file.name, 'name');
    const inputs = fields(file.inputs, 'inputs', 'inputs');
    const known = [...names(inputs.required, 'inputs.required'), ...(inputs.optional === undefined ? [] : names(inputs.optional, 'inputs.optional'))];
    let questions: RegExp | undefined;
    if (file.questions !== undefined) {
        const q = file.questions;
        if (typeof q !== 'string' || q.split('{n}').length !== 2 || /[/\\]|\.\./.test(q)) fail('questions', 'a plain file name in the run folder with one {n}, such as "Q-{n}.md"');
        questions = questionPattern(q);
    }
    hook(file.result, '/result', 'result');
    if (file.onAnswer !== undefined) hook(file.onAnswer, '/onAnswer', 'onAnswer');
    if (file.preflight !== undefined) hook(file.preflight, '/preflight', 'preflight');

    // Each artifact's file is a plain file name in the run folder that no other artifact, question, or engine file uses.
    if (!isObj(file.artifacts)) fail('artifacts', 'must map each artifact to its file');
    const artifacts: LoopConfig['artifacts'] = {};
    const writers = new Map<string, string>();
    for (const [a, spec] of Object.entries(file.artifacts)) {
        const where = `artifact ${a}`;
        const f = text(fields(spec, 'artifact', where).file, `${where}, file`);
        if (/[/\\]|\.\./.test(f)) fail(`${where}, file`, `${f} is not a plain file name in the run folder`);
        if (f === 'run.json' || f === 'out') fail(`${where}, file`, `${f} is a name the engine keeps`);
        if (questions?.test(f.replaceAll('{attempt}', '1'))) fail(`${where}, file`, `${f} matches the questions pattern`);
        if (writers.has(f)) fail(`${where}, file`, `artifact ${writers.get(f)} has the file ${f} already`);
        writers.set(f, a);
        artifacts[a] = { file: f };
        if (spec.guard !== undefined) hook(spec.guard, ptr('artifacts', a, 'guard'), `${where}, guard`);
    }

    if (!Array.isArray(file.stages) || !file.stages.length) fail('stages', 'list the loop\'s stages');
    // ponytail: a stage is read as `any` once its kind is known; `fields` refuses what the kind doesn't take.
    const list = file.stages.map((s: any, i) => {
        const kinds = isObj(s) ? KINDS.filter((k) => k in s) : [];
        if (kinds.length !== 1) fail(`stage #${i + 1}, kind`, `a stage names exactly one of ${KINDS.join(', ')}`);
        const kind = kinds[0];
        const stage = text(s[kind], `stage #${i + 1}, ${kind}`);
        fields(s, kind, `stage ${stage}`);
        return { kind, name: stage, s, i };
    });
    const byName = new Map(list.map((x) => [x.name, x]));
    if (list[0].kind !== 'plan') fail(`stage ${list[0].name}, ${list[0].kind}`, 'the first stage must be a plan stage');
    for (const { kind, name: stage, i } of list) {
        if (kind === 'plan' && i > 0) fail(`stage ${stage}, ${kind}`, 'only the first stage is a plan stage');
        if (kind === 'end' && i < list.length - 1) fail(`stage ${stage}, ${kind}`, 'an end stage comes last');
        if (stage === 'blocked') fail(`stage ${stage}, ${kind}`, 'blocked is the engine\'s own state');
        if (byName.get(stage)!.i !== i) fail(`stage ${stage}, ${kind}`, 'the stage name repeats');
    }
    const near = (i: number, kind: string, step: 1 | -1) => {
        for (let j = i + step; j >= 0 && j < list.length; j += step) if (list[j].kind === kind) return list[j];
    };
    const target = (where: string, to: unknown): string => (typeof to === 'string' && byName.has(to) ? to : fail(where, `${to} is not a stage of the loop`));
    const inferred: string[] = [];
    /** The explicit value, or else the default, recorded at `pointer`. */
    function infer<T>(explicit: T | undefined, pointer: string, fallback: () => T | undefined, where: string): T {
        if (explicit !== undefined) return explicit;
        const v = fallback();
        if (v === undefined) return fail(where, 'there is nothing to infer it from; state it');
        inferred.push(pointer);
        return v;
    }
    const edges = Object.fromEntries(list.map((x) => [x.name, new Set<string>()]));

    const plan = list[0];
    const initial = plan.name;
    hook(plan.s.route, '/route', `stage ${initial}, route`);
    for (const g of [infer<string | string[]>(plan.s.next, ptr('states', initial, '0'), () => list[1]?.name, `stage ${initial}, next`)].flat()) {
        if (byName.get(target(`stage ${initial}, next`, g))!.kind !== 'gate') fail(`stage ${initial}, next`, `${g} is not a gate`);
        edges[initial].add(g);
    }

    const gates: Record<string, GateConfig> = {};
    let freeze: { gate: string; i: number } | undefined;
    for (const x of list.filter((y) => y.kind === 'gate')) {
        const { gate, label, next, back, freezes } = x.s;
        const at = `stage ${gate}`;
        const to = target(`${at}, next`, infer(next, ptr('gates', gate, 'next'), () => list[x.i + 1]?.name, `${at}, next`));
        const from = target(`${at}, back`, infer(back, ptr('gates', gate, 'back'), () => initial, `${at}, back`));
        gates[gate] = { label: text(label, `${at}, label`), next: to, back: from, freezes: freezes === undefined ? [] : names(freezes, `${at}, freezes`) };
        for (const a of gates[gate].freezes) {
            if (!Object.hasOwn(artifacts, a)) fail(`${at}, freezes`, `${a} is not an artifact`);
            if (artifacts[a].file.includes('{attempt}')) fail(`${at}, freezes`, `${a} is written per attempt; a freeze holds one file`);
        }
        if (freezes !== undefined && freeze) fail(`${at}, freezes`, `gate ${freeze.gate} freezes already; one gate freezes`);
        if (freezes !== undefined) freeze = { gate, i: x.i };
        edges[gate].add(to).add(from);
    }

    // A verify stage's targets: `pass` is needed only by its default outcome, `fail` also by the human edges and the limit.
    const verify: Record<string, { pass?: string; fail?: string }> = {};
    let failed: LoopConfig['limits']['failed'];
    for (const x of list.filter((y) => y.kind === 'verify')) {
        const { s, name: v } = x;
        verify[v] = {
            pass: s.pass === undefined ? list[x.i + 1]?.name : target(`stage ${v}, pass`, s.pass),
            fail: s.fail === undefined ? near(x.i, 'work', -1)?.name : target(`stage ${v}, fail`, s.fail),
        };
        if (s.maxFailed === undefined) continue;
        if (!Number.isInteger(s.maxFailed) || s.maxFailed < 1) fail(`stage ${v}, maxFailed`, 'must be a whole number from 1');
        if (failed) fail(`stage ${v}, maxFailed`, `verify stage ${failed.stage} has maxFailed already`);
        failed = { stage: v, at: failOf(v), max: s.maxFailed };
    }
    function failOf(v: string): string {
        return verify[v].fail ?? fail(`stage ${v}, fail`, 'there is nothing to infer it from; state it');
    }

    const dispatches: Record<string, DispatchConfig> = {};
    const byStatus: Record<string, string> = {};
    const add = (x: (typeof list)[number], id: string, def: unknown, defaults: Record<string, () => Action>) => {
        const where = x.kind === 'plan' ? `stage ${x.name}, dispatches.${id}` : `stage ${x.name}, dispatch`;
        const d = fields(def, 'dispatch', where);
        if (dispatches[id]) fail(where, `a dispatch is named ${id} already`);
        const [agent, artifact, message] = (['agent', 'artifact', 'message'] as const).map((k) => text(d[k], `${where}.${k}`));
        if (!Object.hasOwn(artifacts, artifact)) fail(`${where}.artifact`, `${artifact} is not an artifact`);
        if (x.kind !== 'plan') {
            for (const [, p] of message.matchAll(/\{([^{}]*)\}/g)) if (!FIXED.includes(p) && !known.includes(p)) fail(`${where}.message`, `{${p}} is neither a placeholder the engine fills nor an input`);
        }
        const given = d.outcomes ?? {};
        if (!isObj(given)) fail(`${where}.outcomes`, 'must map each status to its action');
        const action = (k: string, a: unknown): Action => {
            const at = `${where}.outcomes.${k}`;
            const kind = isObj(a) && Object.keys(a).length === 1 ? Object.keys(a)[0] : '';
            if (!ACTIONS.includes(kind)) fail(at, 'an outcome takes one of { transition: STAGE }, { route: true }, { ask: true }, { park: true }');
            const v = (a as Record<string, unknown>)[kind];
            if (kind === 'transition') edges[x.name].add(target(at, v));
            else if (v !== true) fail(at, `${kind} takes true`);
            if ((kind === 'route' || kind === 'ask') && x.kind !== 'plan') fail(at, `${kind} runs only in a plan dispatch`);
            if (kind === 'ask' && !questions) fail(at, 'ask needs the loop\'s questions pattern');
            return a as Action;
        };
        const outcomes: Record<string, Action> = {};
        for (const [k, make] of Object.entries(defaults)) {
            if (!Object.hasOwn(given, k)) {
                outcomes[k] = action(k, make());
                inferred.push(ptr('dispatches', id, 'outcomes', k));
            } else if (given[k] !== null) outcomes[k] = action(k, given[k]);
        }
        for (const [k, a] of Object.entries(given)) if (!Object.hasOwn(defaults, k) && a !== null) outcomes[k] = action(k, a);
        dispatches[id] = { agent, artifact, message, outcomes };
    };
    if (!isObj(plan.s.dispatches)) fail(`stage ${initial}, dispatches`, 'must map each plan dispatch to its definition');
    for (const [id, d] of Object.entries(plan.s.dispatches)) add(plan, id, d, {});
    const park = (): Action => ({ park: true });
    for (const x of list.filter((y) => y.kind === 'work' || y.kind === 'verify')) {
        const v = x.kind === 'verify' ? verify[x.name] : undefined;
        const defaults: Record<string, () => Action> = v
            ? {
                pass: () => ({ transition: v.pass ?? fail(`stage ${x.name}, pass`, 'there is nothing to infer it from; state it') }),
                fail: () => ({ transition: failOf(x.name) }),
                blocked: park,
            }
            : {
                ok: () => ({ transition: near(x.i, 'verify', 1)?.name ?? fail(`stage ${x.name}, ok`, 'no verify stage follows to infer it from; state ok: { transition: STAGE }') }),
                blocked: park,
            };
        add(x, x.name, x.s.dispatch, defaults);
        byStatus[x.name] = x.name;
    }

    // The human edges: back past the freezing gate, a retry of the work stage, and a reset of the failed count.
    const human: Record<string, HumanEdge[]> = Object.fromEntries(list.map((x) => [x.name, []]));
    const edge = (stage: string, e: HumanEdge) => {
        const have = human[stage].find((h) => h.to === e.to);
        if (have) Object.assign(have, e);
        else human[stage].push(e);
    };
    if (freeze) for (const x of list.slice(freeze.i + 1)) if (x.kind !== 'end') edge(x.name, { to: gates[freeze.gate].back, drops: freeze.gate });
    for (const x of list) {
        const prev = list[x.i - 1];
        if (x.kind === 'stop' && prev?.kind === 'verify') edge(x.name, { to: failOf(prev.name), retries: true });
        if (x.kind === 'verify') edge(x.name, { to: failOf(x.name), retries: true });
    }
    if (failed) for (const e of Object.values(human).flat()) if (e.to === failed.at) e.resets = true;
    // Every stop lists the human's moves, so a stop stage no human move leaves can't run.
    for (const x of list) if (x.kind === 'stop' && !human[x.name].length) fail(`stage ${x.name}, stop`, 'no human move leaves this stop; give an earlier gate freezes, put a verify stage right before it, or make it an end stage');

    if (file.validators !== undefined && !isObj(file.validators)) fail('validators', 'must map each state to its validator');
    for (const [s, ref] of Object.entries(file.validators ?? {})) {
        if (!byName.has(s)) fail(`validators.${s}`, `${s} is not a stage of the loop`);
        hook(ref, ptr('validators', s), `validators.${s}`);
    }

    const given = file.limits === undefined ? {} : fields(file.limits, 'limits', 'limits');
    for (const [k, n] of Object.entries(given)) if (typeof n !== 'number' || n < 0) fail(`limits.${k}`, 'must be a number from 0');
    const limits: LoopConfig['limits'] = {
        redispatch: infer(given.redispatch, '/limits/redispatch', () => 2, 'limits.redispatch'),
        unusable: infer(given.unusable, '/limits/unusable', () => 1, 'limits.unusable'),
    };
    if (failed) {
        limits.failed = failed;
        inferred.push('/limits/failed');
    }

    const states: Record<string, string[]> = Object.fromEntries(list.map((x) => [x.name, x.kind === 'end' ? [] : [...edges[x.name], 'blocked']]));
    states.blocked = list.filter((x) => x.kind !== 'end').map((x) => x.name);
    // ponytail: the hook places (route, result, guards, ...) stay empty until `loadLoop` fills them from `hooks`.
    const config = {
        name,
        inputs: { required: inputs.required, ...(inputs.optional ? { optional: inputs.optional } : {}) },
        ...(questions ? { questions } : {}),
        initial,
        states,
        human,
        gates,
        ...(freeze ? { freezeGate: freeze.gate } : {}),
        artifacts,
        dispatches,
        byStatus,
        validators: {},
        stops: list.filter((x) => x.kind === 'stop' || x.kind === 'end').map((x) => x.name),
        limits,
        hooks,
        sha256: '',
    } as unknown as LoopConfig;
    INFERRED.set(config, inferred);
    return { config, inferred };
}
