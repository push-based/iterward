import type { Dispatch } from '../../../config.ts';
import { now } from '../../util.ts';

/** Close a dispatch with its outcome (a status, `refused`, or `unusable`) and the lines the step's next open must fix, if any. */
export function close(d: Dispatch, outcome: string, fixes?: string[]) {
    Object.assign(d, { closedAt: now(), outcome, ...(fixes?.length ? { fixes } : {}) });
}
