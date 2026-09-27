#!/usr/bin/env node
/**
 * looplock — the CLI a harness drives a run through. Every state change goes through it, so the rules in
 * engine.mts hold whichever agent calls it. It never starts an agent: `next` returns the dispatch to send,
 * and `result` hands the document the agent wrote to the loop's result hook.
 *
 * Subcommands (a run names its loop file, so only `new` and `compile` take --config):
 *   new         --config <loop.json> --run <run.json> [--<input> <value> …]      runs the loop's preflight first
 *   compile     --config <loop.json>   the compiled loop, and the pointer of each value the compiler inferred
 *   next        --run <run.json>       the move the run needs: {do: dispatch|stop, …}
 *   result      --run <run.json>       reads the open dispatch's document and applies the action of its status
 *   show        --run <run.json>       the run's state
 *   validate    <artifact> --run <run.json>        `ok`, or the artifact guard's error lines with exit 2
 *   answer      --run <run.json> --id <ID> --option <KEY|custom> --answer <the human's words>
 *   gate        <name> --run <run.json> --decision approved|rejected [--note <the human's words>]
 *   transition  --run <run.json> --to <state> --note <the human's words>
 *   --version
 *
 * Run it from the repository root. Each command prints one line of JSON, except `validate`, which prints text.
 * Exit 0 ok, 2 refused (the reason on stderr, its lines grouped), 1 usage error. A refusal over 20,000
 * characters goes whole to <run folder>/out/, and stderr keeps its first 40 lines and names the file.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { group, inferredOf, loadLoop, loop, pendingQuestions, printable, spill, VERSION, type Run } from './engine.mts';

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
        if (!k.startsWith('--')) throw new Usage(`unexpected argument ${k}`);
        if (argv[i + 1] === undefined) throw new Usage(`${k} needs a value`);
        a[k.slice(2)] = argv[++i];
    }
    return a;
}

function req(a: Record<string, any>, keys: string[]) {
    const missing = keys.filter((k) => a[k] == null);
    if (missing.length) throw new Usage(`missing ${missing.map((k) => `--${k}`).join(', ')}`);
}

/** The run and its loop. `loadRun` refuses a run whose loop file or hook modules changed since it started. */
async function open(a: Record<string, any>) {
    req(a, ['run']);
    const raw = JSON.parse(readFileSync(a.run, 'utf8'));
    if (typeof raw?.config?.path !== 'string') throw new Error(`${a.run} names no loop file`);
    const L = loop(await loadLoop(raw.config.path));
    return { L, r: L.loadRun(a.run) };
}

/** Load the run, apply `fn`, and save the run: a refused command changes nothing. */
async function change(a: Record<string, any>, fn: (L: ReturnType<typeof loop>, r: Run) => unknown) {
    const { L, r } = await open(a);
    const out = await fn(L, r);
    L.saveRun(a.run, r);
    return out;
}

const COMMANDS: Record<string, (a: Record<string, any>) => Promise<unknown>> = {
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
    async compile(a) {
        req(a, ['config']);
        const config = await loadLoop(a.config);
        return { config: printable(config), inferred: inferredOf(config) };
    },
    next: (a) => change(a, (L, r) => L.next(a.run, r)),
    result: (a) => change(a, (L, r) => L.result(a.run, r)),
    async show(a) {
        const { L, r } = await open(a);
        return L.show(r);
    },
    async validate(a) {
        const { L, r } = await open(a);
        const errors = await L.validate(a.run, r, a.$);
        if (errors.length) throw new Error(errors.join('\n'));
        return 'ok';
    },
    async answer(a) {
        req(a, ['run', 'id', 'option', 'answer']);
        return change(a, async (L, r) => {
            const q = await L.answerQuestion(a.run, r, { id: a.id, option: a.option, answer: a.answer });
            return { ok: true, id: q.id, chosen: q.chosen, pending: pendingQuestions(r).map((x) => x.id) };
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

const USAGE = `Usage: looplock <${Object.keys(COMMANDS).join('|')}> [flags]`;

export async function main(argv = process.argv.slice(2)) {
    if (argv[0] === '--version') {
        process.stdout.write(`${VERSION}\n`);
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
    const cmd = COMMANDS[a._];
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
        // A refused `new` spills nowhere: its run folder must stay as it was.
        console.error(a.run && a._ !== 'new' ? spill(dirname(a.run), a._, text) : text);
        process.exitCode = 2;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
