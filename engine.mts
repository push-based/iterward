/**
 * looplock engine — the record and the rules of one run of an agentic loop.
 *
 * A loop file (`LoopFile`, which `loadLoop` compiles into a `LoopConfig`) declares the loop's states, its valid
 * transitions, and the condition of each transition, which the consumer writes as hooks. The engine holds the
 * run file and refuses every move the loop doesn't declare. It never starts an agent and never parses a
 * consumer's file: `next` returns the dispatch a harness sends, and `result` hands the document the agent wrote
 * to the loop's result hook.
 *
 * Invariants, enforced on every call from the run file alone:
 *   - status moves only along the compiled states, and a human moves only along the human edges of the state,
 *   - a gate's forward exit needs that gate approved, and a verify stage has no forward exit but a verdict,
 *   - leaving the initial state needs no pending question, and entering the freezing gate also passes the frozen
 *     artifacts' guards,
 *   - an approval freezes the gate's files and an answer freezes its question file; a changed frozen file parks
 *     an agent's move and refuses a human's, and only a human transition back past the gate drops its freeze,
 *   - one `answer` call records all of its answers or none of them,
 *   - a state's validator runs on every transition into it,
 *   - a dispatch's document must be written during the dispatch, and its status must be an outcome of it,
 *   - an unusable or refused result is re-dispatched a bounded number of times, then the run parks,
 *   - a blocked run leaves only by a human move, and a move to blocked needs a note,
 *   - a run refuses to go on under a changed loop file or hook module.
 */

import type { LoopConfig } from './config.mts';
import { context } from './engine/context.mts';
import { answerQuestions } from './engine/decisions/answer-questions.mts';
import { next } from './engine/dispatch/next.mts';
import { result } from './engine/dispatch/result.mts';
import { approve } from './engine/gates/approve.mts';
import { reject } from './engine/gates/reject.mts';
import { loadRun } from './engine/run/load-run.mts';
import { newRun } from './engine/run/new-run.mts';
import { saveRun } from './engine/run/save-run.mts';
import { transition } from './engine/run/transition.mts';
import { show } from './engine/views/show.mts';
import { validate } from './engine/views/validate.mts';

export * from './config.mts';
export { inferredOf, printable } from './compile-loop.mts';
export { loadLoop } from './load-config.mts';
export { pendingQuestions } from './engine/decisions/pending-questions.mts';
export { FreezeError } from './engine/run/freezes.mts';
export { group, spill } from './engine/spill.mts';
export { hasText, sha256 } from './engine/util.mts';

export const VERSION = '0.2.0';

/** The operations of one loop, each bound to the context built from it. */
export function loop(cfg: LoopConfig) {
    const ctx = context(cfg);
    return {
        cfg,
        newRun: newRun.bind(null, ctx),
        loadRun: loadRun.bind(null, ctx),
        saveRun: saveRun.bind(null, ctx),
        transition: transition.bind(null, ctx),
        answerQuestions: answerQuestions.bind(null, ctx),
        approve: approve.bind(null, ctx),
        reject: reject.bind(null, ctx),
        next: next.bind(null, ctx),
        result: result.bind(null, ctx),
        show: show.bind(null, ctx),
        validate: validate.bind(null, ctx),
    };
}
