#!/usr/bin/env node
/**
 * looplock — the CLI a harness drives a run through. Every state change goes through it, so the rules in
 * engine.mts hold whichever agent calls it. It never starts an agent: `next` returns the dispatch to send,
 * and `result` reads the file the agent wrote.
 *
 * Subcommands (a run names its loop configuration, so only `new` takes --config):
 *   new         --config <loop.mts> --run <run.json> [--<input> <value> …]      runs the loop's preflight rows first
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
 * Run it from the repository root. Exit 0 ok, 2 refused (message on stderr), 1 usage error. An output over
 * 20,000 characters goes whole to <run folder>/out/<command>.<N>.json, and the printed view replaces each
 * large value with {spilled: <pointer>}, which `show --file <that file> --pointer <pointer>` reads.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runChecks } from './checks.mts';
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

/** The configuration file and every local file it imports, transitively: the files a run's rules come from. */
function configFiles(entry: string): string[] {
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        // Static import and export statements only: an `import` inside a string, such as a stylesheet line, isn't one.
        for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^;'"]*?(?:from\s*)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
            const dep = resolve(dirname(file), m[1]);
            if (existsSync(dep)) visit(dep);
        }
    };
    visit(resolve(entry));
    return [...seen].sort();
}

/** One hash over the configuration and its imports, with paths relative to the configuration's folder. */
function configHash(entry: string): string {
    const base = dirname(resolve(entry));
    return sha256(configFiles(entry).map((f) => `${relative(base, f)}\0${readFileSync(f, 'utf8')}`).join('\0'));
}

/** The run and its loop; the configuration and the files it imports must be the ones the run started with. */
async function open(a: Record<string, any>) {
    const raw = JSON.parse(readFileSync(a.run, 'utf8'));
    if (!raw.config?.path) throw new Error(`${a.run} names no loop configuration`);
    if (configHash(raw.config.path) !== raw.config.sha256) throw new Error(`the loop's configuration changed since the run started (${raw.config.path} or a file it imports); start a new run`);
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
        const L = loop(await importConfig(a.config));
        req(a, L.cfg.inputs.required);
        if (existsSync(a.run)) throw new Error(`a run exists at ${a.run}; resume it, or move its folder away to start over`);
        const dir = dirname(resolve(a.run));
        if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.DS_Store')) throw new Error(`${dirname(a.run)} holds files from an earlier run; move the folder away to start over`);
        // The preflight logs go to a scratch folder: a refused run leaves nothing in the run's folder.
        let warnings: any[] = [];
        if (L.cfg.preflight) {
            const res = runChecks(join(mkdtempSync(join(tmpdir(), 'looplock-preflight-')), 'run.json'), { root: process.cwd(), stem: 'preflight', ignore: [], rows: L.cfg.preflight, doc: a });
            const failing = res.rows.filter((x) => x.status !== 'pass' && !x.warn);
            if (failing.length) throw new Error(`preflight refuses the run: ${failing.map((x) => `${x.name} ${x.status} (${x.log})`).join('; ')}`);
            warnings = res.warnings.map((x) => ({ row: x.name, status: x.status, log: x.log }));
        }
        const r = L.saveRun(a.run, L.newRun(a, { path: a.config, sha256: configHash(a.config) }));
        return { ok: true, status: r.status, ...(warnings.length ? { warnings } : {}) };
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

/** Agent harnesses cut a tool result near 30,000 characters, and a cut JSON line reads as complete. */
const SPILL_OVER = 20_000;
const SPILL_KEEP = 2_000;

/**
 * An output over SPILL_OVER characters goes whole to <run folder>/out/<command>.<N>.json. The printed view
 * keeps each value up to SPILL_KEEP characters, descends into larger objects, and replaces anything else
 * with {spilled: <JSON pointer>, chars}.
 */
function spill(a: Record<string, any>, out: unknown): unknown {
    const text = JSON.stringify(out);
    if (text.length <= SPILL_OVER || !a.run) return out;
    const dir = join(dirname(a.run), 'out');
    mkdirSync(dir, { recursive: true });
    let n = 1;
    while (existsSync(join(dir, `${a._}.${n}.json`))) n++;
    const file = join(dir, `${a._}.${n}.json`);
    writeFileSync(file, text);
    const view = (v: any, pointer: string): any => {
        const t = JSON.stringify(v) ?? '';
        if (t.length <= SPILL_KEEP) return v;
        if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, view(x, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`)]));
        return { spilled: pointer, chars: t.length, ...(Array.isArray(v) ? { length: v.length } : {}) };
    };
    return { ...view(out, ''), file };
}

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
        process.stdout.write(`${JSON.stringify(spill(a, await cmd(a)))}\n`);
    } catch (e) {
        console.error((e as Error).message);
        process.exitCode = e instanceof Usage ? 1 : 2;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
