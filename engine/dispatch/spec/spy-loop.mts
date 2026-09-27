/**
 * The FDS-shaped fixture loop of `spec/loop/` with every hook replaced by a spy the specs set, a run folder
 * beside it, and helpers to write documents. `engine/dispatch.spec.mts` and `engine.spec.mts` share it.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLoop, loop, type Run } from '../../../engine.mts';

const FIXTURE = fileURLToPath(new URL('../../../spec/loop/fds.loop.json', import.meta.url));
const HOOKS = ['preflight', 'readResult', 'route', 'onAnswer', 'guard', 'gateSummary', 'validator'];
/** Every hook of the loop calls the spy of its name. */
const SPY = HOOKS.map((h) => `export const ${h} = (...a) => globalThis.looplockSpy.${h}(...a);`).join('\n');

type Fn = (...a: any[]) => any;
export const statusOf = (path: string) => /^status:\s*(\S+)\s*$/m.exec(readFileSync(path, 'utf8'))?.[1];

/**
 * The default hooks: the result hook reads the frontmatter status, and the route dispatches discovery, then the
 * draft, then a revision until plan.md says `ok`, and then enters the gate.
 */
const BASE: Record<string, Fn> = {
    preflight: () => ({ errors: [], warnings: [] }),
    readResult: (path: string) => {
        const status = statusOf(path);
        return status ? { status } : { error: `${path} § frontmatter: no status` };
    },
    route: ({ runDir }: { runDir: string }) => {
        if (!existsSync(join(runDir, 'EVID-discovery.md'))) return { dispatch: 'discovery' };
        if (!existsSync(join(runDir, 'plan.md'))) return { dispatch: 'draft' };
        return statusOf(join(runDir, 'plan.md')) === 'ok' ? { gate: 'gate1', onRefusal: 'revision' } : { dispatch: 'revision' };
    },
    onAnswer: () => {},
    guard: () => [],
    gateSummary: ({ gate }: { gate: string }) => [`${gate}: 3 change groups`],
    validator: () => [],
};

export const calls: [string, ...any[]][] = [];

/** Set what each hook does; a hook left out does the default. */
export function spy(over: Record<string, Fn> = {}) {
    calls.length = 0;
    (globalThis as any).looplockSpy = Object.fromEntries(HOOKS.map((h) => [h, (...a: any[]) => {
        calls.push([h, ...a]);
        return (over[h] ?? BASE[h])(...a);
    }]));
}

/** A started run of the spy loop, and helpers for its folder. */
export async function started(inputs: Record<string, string> = { component: 'packages/promo/x/progress-bar' }) {
    const dir = mkdtempSync(join(tmpdir(), 'looplock-dispatch-'));
    mkdirSync(join(dir, 'loop'));
    const runDir = join(dir, 'runs/a');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(dir, 'loop/fds.loop.json'), readFileSync(FIXTURE, 'utf8').replaceAll('./hooks.mts', './spy.mjs'));
    writeFileSync(join(dir, 'loop/spy.mjs'), SPY);
    const L = loop(await loadLoop(join(dir, 'loop/fds.loop.json')));
    const runPath = join(runDir, 'run.json');
    const run: Run = await L.newRun(runPath, inputs, join(dir, 'loop/fds.loop.json'));
    /** Write a document with a frontmatter status, or the text given. */
    const write = (file: string, status = 'ok', body = '') => writeFileSync(join(runDir, file), `---\nid: ${file}\nstatus: ${status}\n---\n${body}`);
    return {
        dir, runDir, runPath, run, L, write,
        next: (): Promise<any> => L.next(runPath, run),
        result: (): Promise<any> => L.result(runPath, run),
    };
}
export type Env = Awaited<ReturnType<typeof started>>;

/** A run at gate1: discovery and the draft done, plan.md `ok`, diff.md written. */
export async function atGate(env?: Env): Promise<Env> {
    const e = env ?? (await started());
    await e.next();
    e.write('EVID-discovery.md');
    await e.result();
    e.write('plan.md');
    e.write('diff.md', 'ok', '# Diff\n');
    const stop = await e.result();
    if (stop.stop !== 'gate') throw new Error(`expected the gate stop, got ${JSON.stringify(stop)}`);
    return e;
}

/** A run at build, the gate approved with `note`, and the build dispatch open. */
export async function building(note = 'ship it'): Promise<Env> {
    const e = await atGate();
    await e.L.approve(e.runPath, e.run, 'gate1', note);
    await e.next();
    return e;
}

/** Wait past the clock's millisecond, so a human move and the dispatch before it never share a timestamp. */
export const tick = () => new Promise((r) => setTimeout(r, 3));
