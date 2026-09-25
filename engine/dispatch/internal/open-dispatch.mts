import type { Run } from '../../../config.mts';

/** The latest dispatch, while no result has closed it. */
export const openDispatch = (run: Run) => {
    const d = run.dispatches?.at(-1);
    return d && !d.closedAt ? d : undefined;
};
