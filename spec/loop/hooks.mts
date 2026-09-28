/** The hooks of the fixture loop `fixture.loop.json`: each one small, so the specs can load and hash the loop. */

import { writeFileSync } from 'node:fs';

import type { Guard, OnAnswer, Preflight, ResultHook, Route, Validator } from '../../config.mts';
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
/** Writes the gate summary as the run enters the gate, and never after, so the approval freezes what the human saw. */
export const summaryGuard: Guard = (path, { event }) => {
    if (event === 'enter') writeFileSync(path, '# Summary\n');
    return [];
};
export const preflight: Preflight = () => ({ errors: [], warnings: [] });
export const validator: Validator = () => [];
