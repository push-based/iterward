import type { Dispatch } from '../../../config.mts';

/** A dispatch as `next` prints it. */
export const dispatchOut = (d: Dispatch) => ({ do: 'dispatch', id: d.id, agent: d.agent, message: d.message });
