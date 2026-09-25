/**
 * looplock engine — the record and the rules of one run of an agentic loop.
 *
 * A loop's configuration (`LoopConfig`) names its states, the artifacts its stages write, its human
 * gates, its verify phases, and how each agent result routes. The engine holds the run file and
 * refuses every move the rules don't allow. It never starts an agent: `next` returns the dispatch a
 * harness sends, and `result` reads the file the agent wrote.
 *
 * Invariants, enforced on every call from the run file alone:
 *   - status moves only along `states`,
 *   - a gate's forward exit needs that gate approved; entering a gate from the initial state needs its
 *     frozen artifact, its required artifacts, no pending question, the decision projection, and its guard,
 *   - a verify state is left only through a verdict (or `blocked`), and a pass needs every obligation of
 *     its phase proven in exactly its evidence mode, plus an all-pass checks record when the phase has checks,
 *   - a blocked run resumes only into the state it blocked from, and a move to blocked needs a note,
 *   - a proof report is cited once: a reused or overwritten report name is refused,
 *   - artifacts live beside the run file with their sha256, and every load refuses a changed file;
 *     a versioned artifact is never overwritten (`<name>.<K>.json`),
 *   - the artifact a gate freezes can't change after approval; only `invalidate` re-opens it,
 *   - human decisions live in an append-only ledger; only a later decision's `supersedes` retires one,
 *   - a result the agent didn't write, or wrote wrong, is re-dispatched a bounded number of times, and a
 *     refused action is re-dispatched with the refusal a bounded number of times, then the run parks.
 */

import type { LoopConfig } from './config.mts';
import { context } from './engine/context.mts';
import { answerQuestion } from './engine/decisions/answer-question.mts';
import { askQuestions } from './engine/decisions/ask-questions.mts';
import { projectionErrors } from './engine/decisions/projection-errors.mts';
import { redirectDraft } from './engine/decisions/redirect-draft.mts';
import { retiredQuestions } from './engine/decisions/retired-questions.mts';
import { dispatchHuman } from './engine/dispatch/dispatch-human.mts';
import { next } from './engine/dispatch/next.mts';
import { result } from './engine/dispatch/result.mts';
import { approve } from './engine/gates/approve.mts';
import { reject } from './engine/gates/reject.mts';
import { loadRun } from './engine/run/load-run.mts';
import { newRun } from './engine/run/new-run.mts';
import { saveRun } from './engine/run/save-run.mts';
import { store } from './engine/run/store.mts';
import { transition } from './engine/run/transition.mts';
import { attemptOf } from './engine/verify/attempt-of.mts';
import { checks } from './engine/verify/checks.mts';
import { invalidate } from './engine/verify/invalidate.mts';
import { recordChecks } from './engine/verify/record-checks.mts';
import { recordVerification } from './engine/verify/record-verification.mts';
import { revokeVerification } from './engine/verify/revoke-verification.mts';
import { pick } from './engine/views/pick.mts';
import { show } from './engine/views/show.mts';
import { summary } from './engine/views/summary.mts';

export * from './config.mts';
export { activeDecisionIds } from './engine/decisions/active-decision-ids.mts';
export { pendingQuestions } from './engine/decisions/pending-questions.mts';
export { questionView } from './engine/decisions/question-view.mts';
export { hasText, proofOnDisk, resolvePointer, sha256 } from './engine/util.mts';

export const VERSION = '0.1.0';

/** The operations of one loop configuration, each bound to the context built from it. */
export function loop(cfg: LoopConfig) {
    const ctx = context(cfg);
    return {
        cfg,
        newRun: newRun.bind(null, ctx),
        loadRun: loadRun.bind(null, ctx),
        saveRun: saveRun.bind(null, ctx),
        transition: transition.bind(null, ctx),
        store: store.bind(null, ctx),
        projectionErrors: projectionErrors.bind(null, ctx),
        askQuestions: askQuestions.bind(null, ctx),
        answerQuestion: answerQuestion.bind(null, ctx),
        redirectDraft: redirectDraft.bind(null, ctx),
        retiredQuestions,
        approve: approve.bind(null, ctx),
        reject: reject.bind(null, ctx),
        recordVerification: recordVerification.bind(null, ctx),
        revokeVerification: revokeVerification.bind(null, ctx),
        invalidate: invalidate.bind(null, ctx),
        checks: checks.bind(null, ctx),
        recordChecks: recordChecks.bind(null, ctx),
        attemptOf,
        show: show.bind(null, ctx),
        pick: pick.bind(null, ctx),
        summary: summary.bind(null, ctx),
        next: next.bind(null, ctx),
        result: result.bind(null, ctx),
        dispatchHuman: dispatchHuman.bind(null, ctx),
    };
}
