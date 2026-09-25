import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import type { Doc } from '../config.mts';

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v);
export const now = (): string => new Date().toISOString();

/** RFC 6901: the value at `pointer` in `doc`, or undefined when it does not resolve. */
export function resolvePointer(doc: Doc, pointer: string): Doc {
    if (pointer === '') return doc;
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
    let cur = doc;
    for (const raw of pointer.slice(1).split('/')) {
        const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
        if (Array.isArray(cur)) {
            if (!/^\d+$/.test(key) || Number(key) >= cur.length) return undefined;
            cur = cur[Number(key)];
        } else if (isObj(cur) && Object.hasOwn(cur, key)) cur = cur[key];
        else return undefined;
    }
    return cur;
}

/** A --proof names a report on disk: a verdict or a re-open can't cite a report that was never written. */
export function proofOnDisk(proof: unknown): string | undefined {
    if (proof == null) return undefined;
    if (!existsSync(String(proof))) throw new Error(`proof report not found: ${proof} (record the path the agent returned, after it wrote the report)`);
    return String(proof);
}
