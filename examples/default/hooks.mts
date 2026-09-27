/**
 * The hooks of the default loop, each a named export that default.loop.json names. They import nothing from
 * looplock, so the folder works wherever you copy it. Every document carries its status in its frontmatter.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** The `key: value` lines of a Markdown file's frontmatter, or undefined when the file has none. */
function frontmatter(path: string): Record<string, string> | undefined {
    const m = FRONTMATTER.exec(readFileSync(path, 'utf8'));
    return m ? Object.fromEntries(m[1].split('\n').map((l) => /^(\w+):(.*)$/.exec(l)).filter((x) => x !== null).map(([, k, v]) => [k, v.trim()])) : undefined;
}

/** The result hook: the step's status is the `status` line of its document's frontmatter. */
export function readResult(path: string): { status: string } | { error: string } {
    const status = frontmatter(path)?.status;
    return status ? { status } : { error: `${basename(path)} § frontmatter: no status` };
}

/** The route: enter the gate once the planner's plan says `ok` and no human note came after the planner's last dispatch. */
export function route({ runDir, run }: { runDir: string; run: { history: { at: string; human?: true }[]; dispatches: { name: string; openedAt: string }[] } }) {
    const plan = join(runDir, 'plan.md');
    const since = run.dispatches.findLast((d) => d.name === 'planner')?.openedAt ?? '';
    const noted = run.history.some((h) => h.human && h.at > since);
    return existsSync(plan) && frontmatter(plan)?.status === 'ok' && !noted ? { gate: 'gate', onRefusal: 'planner' } : { dispatch: 'planner' };
}

/** Writes the human's answer into the question file's frontmatter, through a temporary file and a rename. */
export function onAnswer({ question, option, answer }: { question: { id: string; file: string }; option: string; answer: string }): void {
    const text = readFileSync(question.file, 'utf8');
    const m = FRONTMATTER.exec(text);
    if (!m) throw new Error(`${question.id}.md § frontmatter: no frontmatter to record the answer in`);
    const kept = m[1].split('\n').filter((l) => !/^(status|chosen|answer):/.test(l));
    const head = ['---', ...kept, 'status: resolved', `chosen: ${option}`, `answer: ${JSON.stringify(answer)}`, '---\n'].join('\n');
    writeFileSync(`${question.file}.tmp`, head + text.slice(m[0].length));
    renameSync(`${question.file}.tmp`, question.file);
}

/** The plan's guard: a plan needs `id` and `status` in its frontmatter. */
export function planGuard(path: string): string[] {
    const fm = frontmatter(path);
    return ['id', 'status'].filter((k) => !fm?.[k]).map((k) => `plan.md § frontmatter: no ${k}`);
}
