import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { hasText } from '../util.mts';
import { open } from './internal/open.mts';
import { openDispatch } from './internal/open-dispatch.mts';

/** The human starts a configured route, such as a clarification, with their own words. */
export function dispatchHuman(ctx: Ctx, runPath: string, run: Run, name: string, text: string | undefined) {
    const { cfg } = ctx;
    if (!cfg.human?.includes(name)) throw new Error(`dispatch takes ${(cfg.human ?? []).join(', ') || 'no route'}, not ${name}`);
    if (openDispatch(run)) throw new Error('a dispatch is open: run result first');
    if (!hasText(text)) throw new Error('dispatch needs --text with the human\'s words, verbatim');
    return open(ctx, runPath, run, name, { extra: { text } });
}
