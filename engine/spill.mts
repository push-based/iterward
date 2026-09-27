/**
 * Long output: error lines grouped by their prefix, and text past what an agent harness shows whole written
 * to a file in the run folder's `out/`, with the start printed and the file named.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Agent harnesses cut a tool result near 30,000 characters, and a cut line reads as complete. */
export const SPILL_OVER = 20_000;
const KEEP_LINES = 40;

/**
 * Error lines grouped by their prefix, the text before the first `: `, in order of first appearance: each group
 * prints as `<PREFIX>:` and one `  - <MESSAGE>` line per error. Lines with no prefix form a final group, `other`.
 */
export function group(lines: string[]): string {
    const groups = new Map<string, string[]>();
    const other: string[] = [];
    for (const line of lines) {
        const at = line.indexOf(': ');
        if (at < 0) other.push(line);
        else groups.set(line.slice(0, at), [...(groups.get(line.slice(0, at)) ?? []), line.slice(at + 2)]);
    }
    if (other.length) groups.set('other', [...(groups.get('other') ?? []), ...other]);
    return [...groups].map(([prefix, messages]) => [`${prefix}:`, ...messages.map((m) => `  - ${m}`)].join('\n')).join('\n');
}

/** Writes `text` whole to `<runDir>/out/<name>.<N>.txt`, `<N>` the next unused number, and returns the file. */
export function spillFile(runDir: string, name: string, text: string): string {
    const dir = join(runDir, 'out');
    mkdirSync(dir, { recursive: true });
    let n = 1;
    while (existsSync(join(dir, `${name}.${n}.txt`))) n++;
    const file = join(dir, `${name}.${n}.txt`);
    writeFileSync(file, text);
    return file;
}

/** `text` unchanged up to SPILL_OVER characters; longer text goes whole to a file, and its first 40 lines come back with the file named. */
export function spill(runDir: string, name: string, text: string): string {
    if (text.length <= SPILL_OVER) return text;
    const file = spillFile(runDir, name, text);
    const lines = text.split('\n');
    return [...lines.slice(0, KEEP_LINES), `… ${lines.length - KEEP_LINES} more lines in ${file}`].join('\n');
}
