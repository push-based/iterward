import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { transition } from '../run/transition.mts';
import { hasText } from '../util.mts';
import { gateOf } from './internal/gate-of.mts';
import { recordGate } from './internal/record-gate.mts';

/** Reject a gate with the human's words: the decision is recorded, nothing freezes, and the run moves back. The route reads the note. */
export async function reject(ctx: Ctx, runPath: string, run: Run, name: string, note: string | undefined): Promise<Run> {
    const g = gateOf(ctx, run, name);
    if (!hasText(note)) throw new Error(`a ${g.label} rejection needs --note with the human's words, verbatim`);
    recordGate(ctx, runPath, run, name, 'rejected', note);
    return transition(ctx, runPath, run, g.back, { via: 'gate', note });
}
