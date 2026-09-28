/** The hooks of the fixture loop `fixture.loop.json`: each one small, so the specs can load and hash the loop. */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Guard, OnAnswer, OnEnter, Preflight } from '../../config.mts';
import { statusOf } from './status.mts';

/** The document's frontmatter status, or the error that it has none. */
export const guard: Guard = (path) => {
    const status = statusOf(path);
    return status ? { status } : { errors: [`${path} § frontmatter: no status`] };
};
/** The plan's guard also writes diff.md, an artifact code writes and the gate freezes. */
export const planGuard: Guard = (path, ctx) => {
    if (ctx.event === 'result') writeFileSync(join(ctx.runDir, 'diff.md'), '# Diff\n');
    return guard(path, ctx);
};
export const onAnswer: OnAnswer = () => {};
export const preflight: Preflight = () => ({ errors: [], warnings: [] });
export const onEnter: OnEnter = () => [];
