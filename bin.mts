#!/usr/bin/env node
/**
 * looplock — the CLI a harness drives a run through. Every state change goes through it, so the rules in
 * engine.mts hold whichever agent calls it. It never starts an agent: `next` returns the dispatch to send,
 * and `result` reads the file the agent wrote.
 *
 * Subcommands (a run names its loop configuration, so only `new` takes --config):
 *   new         --config <loop.mts> --run <run.json> [--<input> <value> …]      refuses a run file that exists
 *   next        --run <run.json>      the move the run needs: {do: dispatch|stop|relay, …}
 *   result      --run <run.json>      reads the open dispatch's result file and applies the loop's action
 *   dispatch    <route> --run <run.json> --text <the human's words>            a human-started route
 *   show        --run <run.json> [--file <artifact|draft> [--pointer </p>] [--fields a,b] [--keys]]
 *   summary     --run <run.json> [--gate <name>]
 *   store       <artifact> --run <run.json> --file <file> [--dry-run]
 *   ask         --run <run.json> --questions <file>
 *   answer      --run <run.json> --id <ID> (--option <KEY> | --custom <text>) --answer <the human's words>
 *   decisions   --run <run.json> [--pending | --retired]
 *   redirect    --run <run.json> --note <the human's words>
 *   gate        <name> --run <run.json> --decision approved|rejected [--note <s>] [--scope <s>] [--supersedes <ID>]
 *   checks      --run <run.json>
 *   transition  --run <run.json> --to <status> [--note <s>] [--proof <report>]
 *   verify      --run <run.json> --phase <phase> --verdict pass|fail --proof <report> [--obligations <O1:MODE,O2:MODE>]
 *   revoke      --run <run.json> --phase <phase> --note <s> --proof <review>
 *   invalidate  --run <run.json> --reason <s> [--refs <a:1,b:2>] [--proof <report>]
 *   --version
 *
 * Run it from the repository root. Exit 0 ok, 2 refused (message on stderr), 1 usage error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loop, pendingQuestions, activeDecisionIds, questionView, proofOnDisk, sha256, VERSION, type LoopConfig } from './engine.mts';

/** Flags that take no value. */
const SWITCHES = new Set(['pending', 'retired', 'dry-run', 'keys']);
/** Commands whose second word is a name. */
const NAMED = new Set(['store', 'gate', 'dispatch']);

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
        a[k.slice(2)] = SWITCHES.has(k.slice(2)) ? true : argv[++i];
    }
    return a;
}

function req(a: Record<string, any>, keys: string[]) {
    const missing = keys.filter((k) => a[k] == null);
    if (missing.length) throw new Usage(`missing ${missing.map((k) => `--${k}`).join(', ')}`);
}

async function importConfig(path: string): Promise<LoopConfig> {
    return (await import(pathToFileURL(resolve(path)).href)).default;
}

/** The run and its loop; the loop's configuration file must be the one the run started with. */
async function open(a: Record<string, any>) {
    const raw = JSON.parse(readFileSync(a.run, 'utf8'));
    if (!raw.config?.path) throw new Error(`${a.run} names no loop configuration`);
    const text = readFileSync(resolve(raw.config.path), 'utf8');
    if (sha256(text) !== raw.config.sha256) throw new Error(`the loop's configuration changed since the run started (${raw.config.path}); start a new run`);
    const L = loop(await importConfig(raw.config.path));
    return { L, r: L.loadRun(a.run) };
}

/** Load the run, apply `fn`, and save the run. */
async function change(a: Record<string, any>, fn: (L: ReturnType<typeof loop>, r: any) => any) {
    const { L, r } = await open(a);
    const out = fn(L, r);
    L.saveRun(a.run, r);
    return out;
}

const COMMANDS: Record<string, (a: Record<string, any>) => unknown> = {
    async new(a) {
        req(a, ['config', 'run']);
        const text = readFileSync(resolve(a.config), 'utf8');
        const L = loop(await importConfig(a.config));
        req(a, L.cfg.inputs.required);
        if (existsSync(a.run)) throw new Error(`a run exists at ${a.run}; resume it, or move its folder away to start over`);
        const r = L.saveRun(a.run, L.newRun(a, { path: a.config, sha256: sha256(text) }));
        return { ok: true, status: r.status };
    },
    async next(a) {
        req(a, ['run']);
        return change(a, (L, r) => L.next(a.run, r));
    },
    async result(a) {
        req(a, ['run']);
        return change(a, (L, r) => L.result(a.run, r));
    },
    async dispatch(a) {
        req(a, ['run', 'text']);
        return change(a, (L, r) => L.dispatchHuman(a.run, r, a.$, a.text));
    },
    async show(a) {
        req(a, ['run']);
        const { L, r } = await open(a);
        if (a.file != null) return L.pick(a.run, r, { file: a.file, pointer: a.pointer, fields: a.fields, keys: a.keys });
        const { runPath, ...shown } = L.show(a.run, r);
        return shown;
    },
    async summary(a) {
        req(a, ['run']);
        const { L, r } = await open(a);
        return L.summary(a.run, r, a.gate);
    },
    async store(a) {
        req(a, ['run', 'file']);
        const { L, r } = await open(a);
        if (a['dry-run']) {
            L.store(a.run, r, a.$, a.file, { dryRun: true });
            return { ok: true, dryRun: true };
        }
        L.store(a.run, r, a.$, a.file);
        L.saveRun(a.run, r);
        const shown = L.show(a.run, r);
        return { ok: true, status: r.status, [a.$]: shown[a.$], ...('next' in shown ? { next: shown.next } : {}) };
    },
    async ask(a) {
        req(a, ['run', 'questions']);
        const doc = JSON.parse(readFileSync(a.questions, 'utf8'));
        return change(a, (L, r) => ({ questions: L.askQuestions(r, Array.isArray(doc) ? doc : doc.questions).map(questionView) }));
    },
    async answer(a) {
        req(a, ['run', 'id']);
        return change(a, (L, r) => {
            const d = L.answerQuestion(r, { id: a.id, option: a.option, custom: a.custom, answer: a.answer });
            return { ok: true, id: d.id, chosen: d.chosen, chosenText: d.chosenText, pending: pendingQuestions(r).map((q) => q.id) };
        });
    },
    async redirect(a) {
        req(a, ['run', 'note']);
        return change(a, (L, r) => {
            const rec = L.redirectDraft(r, a.note);
            return { ok: true, retired: rec.retired, next: L.show(a.run, r).next };
        });
    },
    async decisions(a) {
        req(a, ['run']);
        const { L, r } = await open(a);
        if (a.pending) return { pending: pendingQuestions(r).map(questionView) };
        if (a.retired) return { retired: L.retiredQuestions(r).map(questionView) };
        const active = activeDecisionIds(r);
        return { decisions: (r.decisions ?? []).filter((d: any) => active.has(d.id)).map(({ id, topic, question, chosenText, answer, supersedes }: any) => ({ id, topic, question, chosenText, answer, ...(supersedes ? { supersedes } : {}) })) };
    },
    async gate(a) {
        req(a, ['run', 'decision']);
        return change(a, (L, r) => {
            if (a.decision === 'approved') L.approve(r, a.$, a.note);
            else if (a.decision === 'rejected') L.reject(r, a.$, a.note, { supersedes: a.supersedes, scope: a.scope });
            else throw new Error('gate --decision must be approved or rejected');
            // The stored note is printed so the stop summary quotes what the run holds, not what was meant.
            const g = r.gates[a.$];
            return { ok: true, gate: a.$, decision: a.decision, status: r.status, note: g.note ?? null, ...(g.scope ? { scope: g.scope, next: L.show(a.run, r).next } : {}), ...(g.recorded ? { recorded: g.recorded, supersedes: g.supersedes } : {}) };
        });
    },
    async checks(a) {
        req(a, ['run']);
        return change(a, (L, r) => {
            const res = L.checks(a.run, r);
            return { attempt: res.attempt, file: res.file, pass: res.pass, failed: res.failed, blocked: res.blocked, rows: res.rows.map((x: any) => `${x.status.padEnd(7)} ${x.name}  ${x.log}`) };
        });
    },
    async transition(a) {
        req(a, ['run', 'to']);
        return change(a, (L, r) => {
            L.transition(r, a.to, a.note, proofOnDisk(a.proof));
            return { ok: true, status: r.status, blockedFrom: r.blockedFrom };
        });
    },
    async verify(a) {
        req(a, ['run', 'phase', 'verdict']);
        const obligations = a.obligations ? Object.fromEntries(String(a.obligations).split(',').map((p) => p.split(':'))) : {};
        return change(a, (L, r) => {
            L.recordVerification(r, a.phase, a.verdict, proofOnDisk(a.proof), obligations);
            return { ok: true, phase: a.phase, verdict: a.verdict, status: r.status };
        });
    },
    async revoke(a) {
        req(a, ['run', 'phase', 'note', 'proof']);
        return change(a, (L, r) => {
            L.revokeVerification(r, a.phase, a.note, proofOnDisk(a.proof));
            return { ok: true, phase: a.phase, verdict: 'revoked', status: r.status };
        });
    },
    async invalidate(a) {
        req(a, ['run', 'reason']);
        return change(a, (L, r) => {
            L.invalidate(r, { reason: a.reason, refs: a.refs ? String(a.refs).split(',') : [], proof: proofOnDisk(a.proof) });
            return { ok: true, status: r.status };
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
        // The process ends on its own after the write: an explicit exit would cut piped output at 64 KiB.
        process.stdout.write(`${JSON.stringify(await cmd(a))}\n`);
    } catch (e) {
        console.error((e as Error).message);
        process.exitCode = e instanceof Usage ? 1 : 2;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
