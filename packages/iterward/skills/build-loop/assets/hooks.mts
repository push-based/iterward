/**
 * The hooks a loop file names, each a named export. They import nothing from iterward, so the folder works
 * wherever it lives. Every document carries its status in its frontmatter, as a `status:` line.
 *
 * Signatures of the hooks this template has no body for:
 *   export function preflight({ root, runPath, inputs }): { errors: string[]; warnings: string[] }
 *   export function onEnter({ from, to, human, runDir }): string[]   // error lines; [] accepts the transition
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

/** The frontmatter block, after a byte order mark if the file has one, with LF or CRLF line endings. */
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** The `key: value` lines of a Markdown file's frontmatter, or undefined when the file has none. */
function frontmatter(path: string): Record<string, string> | undefined {
    const m = FRONTMATTER.exec(readFileSync(path, 'utf8'));
    return m ? Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^(\w+):(.*)$/.exec(l)).filter((x) => x !== null).map(([, k, v]) => [k, v.trim()])) : undefined;
}

/** A document's guard: its status is the `status` line of its frontmatter. */
export function statusGuard(path: string): { status: string } | { errors: string[] } {
    const status = frontmatter(path)?.status;
    return status ? { status } : { errors: [`${basename(path)} § frontmatter: no status`] };
}

/** Writes the human's answer into the question file's frontmatter, through a temporary file and a rename. */
export function onAnswer({ question, option, answer }: { question: { id: string; file: string }; option: string; answer: string }): void {
    const text = readFileSync(question.file, 'utf8');
    const m = FRONTMATTER.exec(text);
    if (!m) throw new Error(`${question.id}.md § frontmatter: no frontmatter to record the answer in`);
    const kept = m[1].split(/\r?\n/).filter((l) => !/^(status|chosen|answer):/.test(l));
    const head = ['---', ...kept, 'status: resolved', `chosen: ${option}`, `answer: ${JSON.stringify(answer)}`, '---\n'].join('\n');
    writeFileSync(`${question.file}.tmp`, head + text.slice(m[0].length));
    renameSync(`${question.file}.tmp`, question.file);
}
