import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
/** The sha256 of a file's bytes. */
export const fileSha256 = (path: string): string => sha256(readFileSync(path));
export const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v);
export const now = (): string => new Date().toISOString();
/** A guard's error lines, none when it returned a status. */
export const errorsOf = (r: unknown): string[] => (isObj(r) && Array.isArray(r.errors) ? r.errors : []);
