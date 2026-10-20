#!/usr/bin/env node
/**
 * looplock — the CLI a harness drives a run through. Every state change goes through it, so the rules in
 * engine.ts hold whichever agent calls it. It never starts an agent: `next` returns the dispatch to send,
 * and `result` hands the document the agent wrote to its artifact's guard, which returns the status.
 *
 * Subcommands (a run names its loop file, so only `compile` and `new` take --config):
 *   init        [--to <dir>]           copies the default loop to <dir>, loops/default when left out, without its spec
 *   build-loop                         the build-loop skill as text, then each file it reads: designs a loop file
 *   compile     --config <loop.json>   the compiled loop: each step's outcomes resolved from machine
 *   new         --config <loop.json> --run <run.json> [--<input> <value> …]      runs the loop's preflight first
 *   next        --run <run.json>       the move the run needs: {do: dispatch|stop, …}
 *   result      --run <run.json> [--id <N>]   runs the open step's guard on its document and follows the machine;
 *                                      prints {closed: {id, step, outcome}, …the next move}. With --id, refuses
 *                                      before any hook unless dispatch N is the open one
 *   show        --run <run.json>       the run's state
 *   dispatch    --run <run.json>       the open dispatch: {id, step, agent, attempt, document, openedAt, message}
 *   validate    <artifact> --run <run.json>        `ok`, or the artifact guard's error lines with exit 2
 *   answer      --run <run.json> --id <ID> --option <KEY|custom> --answer <the human's words>
 *   answer      --run <run.json> --answers <JSON array of {id, option, answer}>   records all of them or none
 *   gate        <name> --run <run.json> --decision approved|rejected [--note <the human's words>]
 *   transition  --run <run.json> --to <state> --note <the human's words>
 *   mcp         the MCP server over stdio: each tool call runs one of these commands
 *   --version
 *
 * Run it from the repository root. Each command prints one line of JSON, except `validate` and `build-loop`, which
 * print text.
 * Exit 0 ok, 2 refused (the reason on stderr, its lines grouped), 1 usage error. A refusal over 20,000
 * characters goes whole to <run folder>/out/, and stderr keeps its first 40 lines, each cut to 400 characters,
 * and names the file. `next`, `result`, `answer`, `gate`, and `transition` change the run one at a time: each
 * holds <run>.lock while it runs, and refuses while a live process holds it.
 */

import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLoop, loop, printable, VERSION, type Run } from './engine.ts';
import { pendingQuestions } from './engine/decisions/pending-questions.ts';
import { openDispatch } from './engine/dispatch/internal/open-dispatch.ts';
import { group, spill } from './engine/spill.ts';

/** The package folder, which holds the skills and the default loop in a clone and in an install. */
const ROOT = dirname(findPackageJSON('./', import.meta.url)!);

/** Commands whose second word is a name. */
const NAMED = new Set(['validate', 'gate']);

class Usage extends Error {}

function parse(argv: string[]): Record<string, any> {
    const a: Record<string, any> = { _: argv[0] };
    let i = 1;
    if (NAMED.has(argv[0])) {
        if (!argv[1] || argv[1].startsWith('--')) throw new Usage(`${argv[0]} needs a name`);
        a.$ = argv[1];
        i = 2;
    }
    for (; i < argv.length; i++) {
        const k = argv[i];
        // `_` and `$` hold the command and its name, so neither is a flag.
        if (!k.startsWith('--') || k === '--_' || k === '--$') throw new Usage(`unexpected argument ${k}`);
        if (argv[i + 1] === undefined) throw new Usage(`${k} needs a value`);
        a[k.slice(2)] = argv[++i];
    }
    return a;
}

function req(a: Record<string, any>, keys: string[]) {
    const missing = keys.filter((k) => a[k] == null);
    if (missing.length) throw new Usage(`missing ${missing.map((k) => `--${k}`).join(', ')}`);
}

/** `--answers`: a JSON array of one or more objects, each `{ id, option, answer }`. The engine checks each entry. */
function parseAnswers(json: string): Record<string, any>[] {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {}
    if (!Array.isArray(v) || !v.length || !v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) throw new Usage('--answers takes a JSON array of one or more { id, option, answer } objects');
    return v;
}

/** The run and its loop. `loadRun` refuses a run whose loop file or hook modules changed since it started. */
async function open(a: Record<string, any>) {
    req(a, ['run']);
    const raw = JSON.parse(readFileSync(a.run, 'utf8'));
    if (typeof raw?.config?.path !== 'string') throw new Error(`${a.run} names no loop file`);
    const L = loop(await loadLoop(raw.config.path));
    return { L, r: L.loadRun(a.run) };
}

const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
};

/** Blocks for `ms` milliseconds. */
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Take `<run>.lock` for `command`, and return its release. The lock is created exclusively. A lock that a live process
 * other than this one holds refuses the command. A lock whose process is gone, that names this process (a container
 * reuses PIDs), or that stays empty or unreadable is stale, and the command takes it over once. The release removes
 * the lock only while it is still this command's.
 */
function lock(run: string, command: string): () => void {
    const file = `${run}.lock`;
    const text = JSON.stringify({ pid: process.pid, command, at: new Date().toISOString() });
    const read = () => {
        try {
            return readFileSync(file, 'utf8');
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
        }
    };
    for (let tookOver = false; ; ) {
        try {
            writeFileSync(file, text, { flag: 'wx' });
            return () => {
                if (read() === text) rmSync(file, { force: true });
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
        let held = read();
        if (held === '') {
            pause(100); // created by its command, but not yet written
            held = read();
        }
        if (held === null) continue; // its command ended meanwhile
        let h: Record<string, any> = {};
        try {
            h = JSON.parse(held);
        } catch {}
        if (tookOver || (Number.isInteger(h.pid) && h.pid !== process.pid && alive(h.pid))) throw new Error(`another looplock command (${h.command}, pid ${h.pid}, since ${h.at}) holds ${file}; run this one again after it ends, or delete ${file} when no such process runs`);
        if (read() === held) rmSync(file, { force: true });
        tookOver = true;
    }
}

/** Under the run's lock, load the run, apply `fn`, and save the run: a refused command changes nothing. */
async function change(a: Record<string, any>, fn: (L: ReturnType<typeof loop>, r: Run) => unknown) {
    req(a, ['run']);
    if (!existsSync(a.run)) throw new Error(`no run at ${a.run}`);
    const unlock = lock(a.run, a._);
    try {
        const { L, r } = await open(a);
        const out = await fn(L, r);
        L.saveRun(a.run, r);
        return out;
    } finally {
        unlock();
    }
}

const COMMANDS: Record<string, (a: Record<string, any>) => Promise<unknown>> = {
    // The spec stays behind: it runs this package's CLI by a path the copy doesn't have.
    async init(a) {
        const to = a.to ?? 'loops/default';
        if (existsSync(to)) throw new Error(`${to} exists; pass --to with a folder that doesn't`);
        const from = join(ROOT, 'examples/default');
        cpSync(from, to, { recursive: true, filter: (src) => src !== join(from, 'default.spec.mts') });
        return { ok: true, config: join(to, 'default.loop.json') };
    },
    // The skill, then each file it reads after a line that names the file, so an agent without the files gets all of it.
    async 'build-loop'() {
        const dir = join(ROOT, 'skills/build-loop');
        const file = (f: string) => readFileSync(join(dir, f), 'utf8').trimEnd();
        return [file('SKILL.md'), `# File: references/loop-file.md\n\n${file('references/loop-file.md')}`, `# File: assets/hooks.mts\n\n\`\`\`ts\n${file('assets/hooks.mts')}\n\`\`\``].join('\n\n');
    },
    async compile(a) {
        req(a, ['config']);
        const config = await loadLoop(a.config);
        return { config: printable(config) };
    },
    async new(a) {
        req(a, ['config', 'run']);
        const L = loop(await loadLoop(a.config));
        req(a, L.cfg.inputs.required);
        if (existsSync(a.run)) throw new Error(`a run exists at ${a.run}; resume it, or move its folder away to start over`);
        const dir = dirname(resolve(a.run));
        if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.DS_Store')) throw new Error(`${dirname(a.run)} holds files from an earlier run; move the folder away to start over`);
        const { _, config, run, ...inputs } = a;
        const r = L.saveRun(a.run, await L.newRun(a.run, inputs, a.config));
        return { ok: true, status: r.status, warnings: r.warnings };
    },
    next: (a) => change(a, (L, r) => L.next(a.run, r)),
    async result(a) {
        if (a.id != null && !/^[1-9]\d*$/.test(a.id)) throw new Usage('result --id takes a dispatch id, such as 3');
        return change(a, (L, r) => L.result(a.run, r, a.id == null ? undefined : Number(a.id)));
    },
    async show(a) {
        const { L, r } = await open(a);
        return L.show(r);
    },
    // Read only: no lock, no save, and no spill file.
    async dispatch(a) {
        const { r } = await open(a);
        const d = openDispatch(r);
        if (!d) throw new Error('no open dispatch');
        return { id: d.id, step: d.name, agent: d.agent, attempt: d.attempt, document: d.document, openedAt: d.openedAt, message: d.message };
    },
    async validate(a) {
        const { L, r } = await open(a);
        const errors = await L.validate(a.run, r, a.$);
        if (errors.length) throw new Error(errors.join('\n'));
        return 'ok';
    },
    async answer(a) {
        req(a, ['run']);
        const single = ['id', 'option', 'answer'].some((k) => a[k] != null);
        if (single === (a.answers != null)) throw new Usage('answer takes either --answers, or --id, --option, and --answer');
        if (single) req(a, ['id', 'option', 'answer']);
        const answers = single ? [{ id: a.id, option: a.option, answer: a.answer }] : parseAnswers(a.answers);
        return change(a, async (L, r) => {
            const answered = await L.answerQuestions(a.run, r, answers);
            return { ok: true, answered: answered.map((q) => ({ id: q.id, chosen: q.chosen })), pending: pendingQuestions(r).map((x) => x.id) };
        });
    },
    async gate(a) {
        req(a, ['run', 'decision']);
        return change(a, async (L, r) => {
            if (a.decision === 'approved') await L.approve(a.run, r, a.$, a.note);
            else if (a.decision === 'rejected') await L.reject(a.run, r, a.$, a.note);
            else throw new Usage('gate --decision takes approved or rejected');
            // The stored note is printed, so the orchestrator quotes what the run holds, not what was meant.
            return { ok: true, gate: a.$, decision: a.decision, status: r.status, note: r.gates[a.$].note ?? null };
        });
    },
    async transition(a) {
        req(a, ['run', 'to', 'note']);
        return change(a, async (L, r) => {
            await L.transition(a.run, r, a.to, { via: 'human', note: a.note });
            return { ok: true, status: r.status, blockedFrom: r.blockedFrom ?? null };
        });
    },
};

const USAGE = `Usage: looplock <${[...Object.keys(COMMANDS), 'mcp'].join('|')}> [flags]`;

export async function main(argv = process.argv.slice(2)) {
    if (argv[0] === '--version') {
        process.stdout.write(`${VERSION}\n`);
        return;
    }
    // The server answers requests on stdin until the client closes it.
    if (argv[0] === 'mcp' && argv.length === 1) {
        await import('./mcp/server.ts');
        return;
    }
    let a;
    try {
        a = parse(argv);
    } catch (e) {
        console.error(`${(e as Error).message}\n${USAGE}`);
        process.exitCode = 1;
        return;
    }
    const cmd = Object.hasOwn(COMMANDS, a._) ? COMMANDS[a._] : undefined;
    if (!cmd) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }
    try {
        const out = await cmd(a);
        // The process ends on its own after the write: an explicit exit would cut piped output at 64 KiB.
        process.stdout.write(`${typeof out === 'string' ? out : JSON.stringify(out)}\n`);
    } catch (e) {
        if (e instanceof Usage) {
            console.error(`${e.message}\n${USAGE}`);
            process.exitCode = 1;
            return;
        }
        const text = group((e as Error).message.split('\n'));
        // A refused `new` spills nowhere, so its run folder stays as it was, and `dispatch` writes nothing.
        console.error(a.run && a._ !== 'new' && a._ !== 'dispatch' ? spill(dirname(a.run), a._, text) : text);
        process.exitCode = 2;
    }
}

// A bin link runs this file through a symlink, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
