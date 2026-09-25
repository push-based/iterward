import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { activeDecisionIds } from '../decisions/active-decision-ids.mts';
import { transition } from '../run/transition.mts';
import { hasText, now } from '../util.mts';
import { gateOf } from './internal/gate-of.mts';
import { recordGate } from './internal/record-gate.mts';

/**
 * Reject a gate with the human's words and a scope. A scope's `restamp` keeps those artifacts current
 * for the next cycle. `supersedes` records the words as the decision that supersedes that active one.
 */
export function reject(ctx: Ctx, run: Run, name: string, note: string | undefined, { supersedes, scope }: { supersedes?: string; scope?: string } = {}): Run {
    const g = gateOf(ctx, run, name);
    if (!hasText(note)) throw new Error(`a ${g.label} rejection needs --note with the human's words, verbatim`);
    const scopes = Object.keys(g.scopes ?? {});
    if (scopes.length && !scopes.includes(scope as string)) throw new Error(`a ${g.label} rejection needs --scope ${scopes.join('|')}: the human's one word for what it challenges`);
    const restamp = (scope && g.scopes?.[scope]?.restamp) || [];
    for (const a of restamp) if (!run.artifacts[a]) throw new Error(`a ${scope} rejection needs a stored ${a} to carry into the new cycle`);
    let recorded;
    if (supersedes != null) {
        if (!activeDecisionIds(run).has(supersedes)) throw new Error(`--supersedes ${supersedes} is not an active decision (decisions lists them)`);
        recorded = `D${(run.questions ?? []).length + 1}`;
        const at = now();
        const question = `${g.label} rejected ${g.freezes ? run.artifacts[g.freezes]?.path ?? `the ${g.freezes}` : 'the run'}; the rejection changes ${supersedes}.`;
        const topic = `${g.label} rejection`;
        (run.questions ??= []).push({ id: recorded, topic, question, options: [], recommendation: null, supersedes, askedAt: at });
        (run.decisions ??= []).push({ id: recorded, topic, question, options: [], recommendation: null, answer: note, chosen: 'custom', chosenText: note, supersedes, at });
    }
    recordGate(ctx, run, name, 'rejected', note, { ...(scope ? { scope } : {}), ...(recorded ? { supersedes, recorded } : {}) });
    for (const a of restamp) run.artifacts[a].seq = run.seq = (run.seq ?? 0) + 1;
    return transition(ctx, run, g.back ?? ctx.cfg.initial, `${name} rejected`);
}
