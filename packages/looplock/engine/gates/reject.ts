import type { Run } from '../../config.ts';
import type { Ctx } from '../context.ts';
import { transition } from '../run/transition.ts';
import { hasText } from '../util.ts';
import { gateOf } from './internal/gate-of.ts';
import { recordGate } from './internal/record-gate.ts';

/** Reject a gate with the human's words: the decision is recorded, nothing freezes, and the run moves to the machine's `<gate>.reject`, whose next open carries the note. */
export async function reject(ctx: Ctx, runPath: string, run: Run, name: string, note: string | undefined): Promise<Run> {
    const g = gateOf(ctx, run, name);
    if (!hasText(note)) throw new Error(`a ${g.label} rejection needs --note with the human's words, verbatim`);
    recordGate(ctx, runPath, run, name, 'rejected', note);
    return transition(ctx, runPath, run, g.reject, { via: 'gate', note });
}
