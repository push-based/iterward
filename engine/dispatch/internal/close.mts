import type { Dispatch } from '../../../config.mts';
import { now } from '../../util.mts';

/** Close a dispatch with its outcome, a status or `unusable`, and the refusal or the error, if any. */
export function close(d: Dispatch, outcome: string, note?: string) {
    Object.assign(d, { closedAt: now(), outcome, ...(note ? { note } : {}) });
}
