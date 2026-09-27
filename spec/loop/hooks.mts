/** The hooks of the fixture loop `fds.loop.json`: each one small, so the specs can load and hash the loop. */

import type { GateSummary, Guard, OnAnswer, Preflight, ResultHook, Route, Validator } from '../../config.mts';
import { statusOf } from './status.mts';

/** Not a hook: the statuses the fixture's documents carry. */
export const STATUSES = ['ok', 'needs-decisions', 'blocked', 'upheld', 'rejected', 'unsure', 'pass', 'fail', 'plan-invalidated'];

export const readResult: ResultHook = (path) => {
    const status = statusOf(path);
    return status ? { status } : { error: `${path} § frontmatter: no status` };
};
export const route: Route = () => ({ dispatch: 'discovery' });
export const onAnswer: OnAnswer = () => {};
export const guard: Guard = () => [];
export const preflight: Preflight = () => ({ errors: [], warnings: [] });
export const gateSummary: GateSummary = ({ gate }) => [`${gate}: nothing to summarize`];
export const validator: Validator = () => [];
