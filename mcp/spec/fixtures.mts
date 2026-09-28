/**
 * Setup the CLI and MCP specs share: a copy of the fixture loop of `spec/loop/` with hooks a spec steers through
 * files in the run folder, run paths, and a run started through the CLI, also one stopped on its questions.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ToolResult } from '../shared/handler.mts';

export const BIN = fileURLToPath(new URL('../../bin.mts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../spec/loop/fixture.loop.json', import.meta.url));

/**
 * The hooks: the result hook reads the frontmatter status, the route always dispatches discovery, `onAnswer`
 * refuses the option `Z`, the guard returns the lines of `errors.txt` in the run folder, the summary's guard writes
 * summary.md as the run enters the gate, and the preflight warns, and refuses the subject `bad`.
 */
const HOOKS = `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statusOf } from './status.mjs';
export const readResult = (path) => (statusOf(path) ? { status: statusOf(path) } : { error: path + ' § frontmatter: no status' });
export const route = () => ({ dispatch: 'discovery' });
export const onAnswer = ({ question, option }) => { if (option === 'Z') throw new Error(question.id + '.md § Options: no option Z'); };
export const guard = (path, { runDir }) => (existsSync(join(runDir, 'errors.txt')) ? readFileSync(join(runDir, 'errors.txt'), 'utf8').split('\\n').filter(Boolean) : []);
export const preflight = ({ inputs }) => ({ errors: inputs.subject === 'bad' ? ['mcp.json § looplock: autoApprove lists gate'] : [], warnings: ['no linter'] });
export const summaryGuard = (path, { event }) => (event === 'enter' && writeFileSync(path, '# Summary\\n'), []);
export const validator = () => [];
`;
const STATUS = "import { readFileSync } from 'node:fs';\nexport const statusOf = (path) => /^status:\\s*(\\S+)\\s*$/m.exec(readFileSync(path, 'utf8'))?.[1];\n";

/** A folder holding the loop file `loop.json`, its hooks, and the module they import; returns the folder. */
export function makeLoop(): string {
    const dir = mkdtempSync(join(tmpdir(), 'looplock-loop-'));
    writeFileSync(join(dir, 'loop.json'), readFileSync(FIXTURE, 'utf8').replaceAll('./hooks.mts', './hooks.mjs'));
    writeFileSync(join(dir, 'hooks.mjs'), HOOKS);
    writeFileSync(join(dir, 'status.mjs'), STATUS);
    return dir;
}

/** A run path in a fresh folder, with no run in it. */
export const runPath = () => join(mkdtempSync(join(tmpdir(), 'looplock-mcp-')), 'run.json');

/** A run of a fresh fixture loop at `plan`. */
export function startedRun(): string {
    const run = runPath();
    assert.equal(spawnSync(process.execPath, [BIN, 'new', '--config', join(makeLoop(), 'loop.json'), '--run', run, '--subject', 'the progress bar']).status, 0);
    return run;
}

/** A run of a fresh fixture loop at `plan`, stopped on a pending question for each id, such as Q-1. */
export function askedRun(...ids: string[]): string {
    const run = startedRun();
    const cli = (cmd: string) => spawnSync(process.execPath, [BIN, cmd, '--run', run], { encoding: 'utf8' });
    assert.equal(cli('next').status, 0);
    for (const file of [...ids.map((id) => `${id}.md`), 'notes.md']) writeFileSync(join(dirname(run), file), `---\nid: ${file}\nstatus: ok\n---\n`);
    assert.equal(JSON.parse(cli('result').stdout).stop, 'questions');
    return run;
}

export const text = (res: ToolResult) => res.content[0].text;
export const json = (res: ToolResult) => JSON.parse(text(res));
