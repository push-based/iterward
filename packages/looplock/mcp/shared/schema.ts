import type { Prop, ToolSchema } from './handler.ts';

/** Arguments that several tools take, with one description each. */
export const COMMON = {
    run: { type: 'string', description: 'The run file, such as runs/example/run.json, relative to the repository root the server runs in.' },
    note: { type: 'string', description: "The human's words, stored as given." },
} as const satisfies Record<string, Prop>;

export const ANNOTATIONS = {
    /** Reads the run and changes nothing. */
    read: { readOnlyHint: true, openWorldHint: false },
    /** Changes the run file or writes beside it, and never deletes. */
    write: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
} as const satisfies Record<string, Omit<ToolSchema['annotations'], 'title'>>;
