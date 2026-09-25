/**
 * checks — the harness that runs a loop's check rows for one verify attempt. The loop's `rows` function
 * adds each row through `cmd` (an external command) or `fact` (a row it decides from files). A row is
 * `pass`, `fail`, or `blocked` (the command could not run). Each row's full output goes to its own log
 * file, and the caller prints one line per row, so nothing here floods an agent's context.
 *
 * External commands run with argument arrays, never through a shell, so a value from an artifact can
 * never inject a command.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_BUFFER = 256 * 1024 * 1024;

/** A changed path; a rename also names the path it came `from`. */
export interface ChangedFile { code: string; path: string; from?: string }
/** A row; a `warn` row reports its status without failing the run of rows. */
export interface Row { name: string; command: string; exit: number | null; status: 'pass' | 'fail' | 'blocked'; log: string; warn?: boolean }

export interface RowsHarness {
    /** A row backed by an external command. `judge(result)` returns pass|fail|blocked; the default is exit 0. */
    cmd: (name: string, argv: string[], o?: { env?: Record<string, string>; judge?: (r: SpawnSyncReturns<string>) => Row['status']; warn?: boolean }) => void;
    /** A row decided from files; `detail` is what the log records. */
    fact: (name: string, command: string, status: Row['status'], detail: string, o?: { warn?: boolean }) => void;
    /** Every changed path in the working tree (tracked and untracked), minus the loop's ignored prefixes. */
    changed: ChangedFile[];
    /** The changed paths that still exist. */
    present: ChangedFile[];
    root: string;
    /** The loop's frozen artifact, or for preflight rows the run's inputs. */
    doc: any;
}

const unquote = (p: string) => p.replace(/^"|"$/g, '');

/** Changed paths from `git status --porcelain`, minus the paths that start with an ignored prefix. */
export function changedFiles(root: string, ignore: string[]): ChangedFile[] {
    const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (r.status !== 0) throw new Error(`git status failed in ${root}: ${r.stderr}`);
    return r.stdout.split('\n').filter(Boolean).map((l) => {
        const [a, b] = l.slice(3).split(' -> ');
        return b === undefined ? { code: l.slice(0, 2), path: unquote(a) } : { code: l.slice(0, 2), path: unquote(b), from: unquote(a) };
    }).filter((f) => !ignore.some((p) => f.path.startsWith(p)));
}

/**
 * The working tree a checks record judged: HEAD, every changed path, and the content of each changed file
 * that still exists. A verdict cites a record only while the tree is the same.
 */
export function treeHash(root: string, ignore: string[]): string {
    const h = createHash('sha256');
    h.update(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout ?? '');
    for (const f of changedFiles(root, ignore).sort((x, y) => (x.path < y.path ? -1 : 1))) {
        h.update(`\0${f.code}\0${f.path}\0${f.from ?? ''}\0`);
        const file = join(root, f.path);
        if (existsSync(file) && statSync(file).isFile()) h.update(readFileSync(file));
    }
    return h.digest('hex');
}

/**
 * Run the rows and write `<stem>.json` plus `<stem>/<NN>-<row>.log` beside the run file. The caller picks
 * a stem no earlier record used, so no record's file is overwritten.
 */
export function runChecks(runPath: string, o: { root: string; stem: string; ignore: string[]; rows: (h: RowsHarness) => void; doc: any }) {
    const logDir = join(dirname(runPath), o.stem);
    mkdirSync(logDir, { recursive: true });
    const rows: Row[] = [];
    const logPath = (name: string) => join(logDir, `${String(rows.length + 1).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '-')}.log`);
    const cmd: RowsHarness['cmd'] = (name, argv, { env, judge, warn } = {}) => {
        const r = spawnSync(argv[0], argv.slice(1), { cwd: o.root, encoding: 'utf8', maxBuffer: MAX_BUFFER, env: { ...process.env, ...env } });
        const log = logPath(name);
        writeFileSync(log, `$ ${argv.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`);
        const status = r.error || r.status === 127 ? 'blocked' : judge ? judge(r) : r.status === 0 ? 'pass' : 'fail';
        rows.push({ name, command: argv.join(' '), exit: r.status, status, log, ...(warn ? { warn } : {}) });
    };
    const fact: RowsHarness['fact'] = (name, command, status, detail, { warn } = {}) => {
        const log = logPath(name);
        writeFileSync(log, `${command}\n${detail}\n`);
        rows.push({ name, command, exit: null, status, log, ...(warn ? { warn } : {}) });
    };
    const changed = changedFiles(o.root, o.ignore);
    o.rows({ cmd, fact, changed, present: changed.filter((f) => !f.code.includes('D')), root: o.root, doc: o.doc ?? {} });
    const file = join(dirname(runPath), `${o.stem}.json`);
    writeFileSync(file, `${JSON.stringify({ rows }, null, 2)}\n`);
    const failed = rows.filter((r) => r.status === 'fail' && !r.warn).length;
    const blocked = rows.filter((r) => r.status === 'blocked' && !r.warn).length;
    const warnings = rows.filter((r) => r.status !== 'pass' && r.warn);
    return { file, rows, pass: failed === 0 && blocked === 0, failed, blocked, warnings, tree: treeHash(o.root, o.ignore) };
}
