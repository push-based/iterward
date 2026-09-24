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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_BUFFER = 256 * 1024 * 1024;

export interface ChangedFile { code: string; path: string }
export interface Row { name: string; command: string; exit: number | null; status: 'pass' | 'fail' | 'blocked'; log: string }

export interface RowsHarness {
    /** A row backed by an external command. `judge(result)` returns pass|fail|blocked; the default is exit 0. */
    cmd: (name: string, argv: string[], o?: { env?: Record<string, string>; judge?: (r: SpawnSyncReturns<string>) => Row['status'] }) => void;
    /** A row decided from files; `detail` is what the log records. */
    fact: (name: string, command: string, status: Row['status'], detail: string) => void;
    /** Every changed path in the working tree (tracked and untracked), minus the loop's ignored prefixes. */
    changed: ChangedFile[];
    /** The changed paths that still exist. */
    present: ChangedFile[];
    root: string;
    /** The loop's frozen artifact. */
    doc: any;
}

/** Changed paths from `git status --porcelain`, minus the paths that start with an ignored prefix. */
export function changedFiles(root: string, ignore: string[]): ChangedFile[] {
    const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (r.status !== 0) throw new Error(`git status failed in ${root}: ${r.stderr}`);
    return r.stdout.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), path: l.slice(3).split(' -> ').at(-1)!.replace(/^"|"$/g, '') }))
        .filter((f) => !ignore.some((p) => f.path.startsWith(p)));
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
    const cmd: RowsHarness['cmd'] = (name, argv, { env, judge } = {}) => {
        const r = spawnSync(argv[0], argv.slice(1), { cwd: o.root, encoding: 'utf8', maxBuffer: MAX_BUFFER, env: { ...process.env, ...env } });
        const log = logPath(name);
        writeFileSync(log, `$ ${argv.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`);
        const status = r.error || r.status === 127 ? 'blocked' : judge ? judge(r) : r.status === 0 ? 'pass' : 'fail';
        rows.push({ name, command: argv.join(' '), exit: r.status, status, log });
    };
    const fact: RowsHarness['fact'] = (name, command, status, detail) => {
        const log = logPath(name);
        writeFileSync(log, `${command}\n${detail}\n`);
        rows.push({ name, command, exit: null, status, log });
    };
    const changed = changedFiles(o.root, o.ignore);
    o.rows({ cmd, fact, changed, present: changed.filter((f) => !f.code.includes('D')), root: o.root, doc: o.doc ?? {} });
    const file = join(dirname(runPath), `${o.stem}.json`);
    writeFileSync(file, `${JSON.stringify({ rows }, null, 2)}\n`);
    const failed = rows.filter((r) => r.status === 'fail').length;
    const blocked = rows.filter((r) => r.status === 'blocked').length;
    return { file, rows, pass: failed === 0 && blocked === 0, failed, blocked };
}
