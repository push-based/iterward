import { resolve } from 'node:path';

import type { Dispatch, DispatchInfo, Run } from '../../../config.mts';

/** The latest dispatch, while no result has closed it. */
export const openDispatch = (run: Run): Dispatch | undefined => {
    const d = run.dispatches.at(-1);
    return d && !d.closedAt ? d : undefined;
};

/** A dispatch as a hook receives it, its document absolute. */
export const info = ({ id, name, agent, attempt, document, openedAt }: Dispatch): DispatchInfo => ({ id, name, agent, attempt, document: resolve(document), openedAt });
