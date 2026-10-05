/**
 * Long output: error lines grouped by their prefix, and text past what an agent harness shows whole written
 * to a file in the run folder's `out/`, with the start printed and the file named.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Agent harnesses cut a tool result near 30,000 characters, and a cut line reads as complete. */
export const SPILL_OVER = 20_000;
const KEEP_LINES = 40;
/** A kept line past this many characters is cut, because one line can hold most of the text. */
const KEEP_CHARS = 400;

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
    // Created exclusively, so two refusals spilling at once never share a file.
    for (let n = 1; ; n++) {
        const file = join(dir, `${name}.${n}.txt`);
        try {
            writeFileSync(file, text, { flag: 'wx' });
            return file;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
    }
}

/**
 * `text` unchanged up to SPILL_OVER characters; longer text goes whole to a file, and its first 40 lines come back,
 * each cut to 400 characters and `…`, with the file named.
 */
export function spill(runDir: string, name: string, text: string): string {
    if (text.length <= SPILL_OVER) return text;
    const file = spillFile(runDir, name, text);
    const lines = text.split('\n');
    // Cut by code point, so a cut never splits a surrogate pair.
    const kept = lines.slice(0, KEEP_LINES).map((l) => (l.length > KEEP_CHARS ? `${Array.from(l).slice(0, KEEP_CHARS).join('')}…` : l));
    const more = lines.length - KEEP_LINES;
    return [...kept, more > 0 ? `… ${more} more lines in ${file}` : `… the whole text is in ${file}`].join('\n');
}
