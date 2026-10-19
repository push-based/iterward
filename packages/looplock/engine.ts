/**
 * looplock engine — the record and the rules of one run of an agentic loop.
 *
 * A loop file (`LoopFile`, which `loadLoop` compiles into a `LoopConfig`) declares the loop's steps with their
 * outcomes, its gates and stops, and `machine`, the target of each outcome; the consumer writes the checks as
 * hooks. The engine holds the run file and refuses every move the loop doesn't declare. It never starts an agent
 * and never parses a consumer's file: `next` returns the dispatch a harness sends, and `result` hands the
 * document the agent wrote to its artifact's guard, which returns the status.
 *
 * Invariants, enforced on every call from the run file alone:
 *   - status moves only along `machine`, a gate's decisions, and the human moves the loop lists,
 *   - a gate is left only by a decision; entering one needs no pending question and passes the guards of the
 *     artifacts it freezes, and approving it passes them again,
 *   - pending questions stop the run before any step opens,
 *   - an approval freezes the gate's files and an answer freezes its question file; a changed frozen file parks
 *     an agent's move and refuses a human's, and only a human move into a step that writes a frozen artifact
 *     drops that gate's freeze,
 *   - one `answer` call records all of its answers or none of them,
 *   - a step's, gate's, or stop's `onEnter` runs on every transition into it,
 *   - a dispatch's document must be written during the dispatch, and its guard's status must be an outcome of
 *     the step; an unusable or refused result, or a refused transition, opens the same step again,
 *   - a step opens at most `limits.opens` times since the last human move, then the run parks,
 *   - a blocked run leaves only by a human move, and a move to blocked needs a note,
 *   - a run refuses to go on under a changed loop file or hook module, or under an engine of another version line,
 *   - run.json is replaced whole, through a temporary file and a rename.
 */

import type { LoopConfig } from './config.ts';
import { context } from './engine/context.ts';
import { answerQuestions } from './engine/decisions/answer-questions.ts';
import { next } from './engine/dispatch/next.ts';
import { result } from './engine/dispatch/result.ts';
import { approve } from './engine/gates/approve.ts';
import { reject } from './engine/gates/reject.ts';
import { loadRun } from './engine/run/load-run.ts';
import { newRun } from './engine/run/new-run.ts';
import { saveRun } from './engine/run/save-run.ts';
import { transition } from './engine/run/transition.ts';
import { show } from './engine/views/show.ts';
import { validate } from './engine/views/validate.ts';

export * from './config.ts';
export { printable } from './compile-loop.ts';
export { loadLoop } from './load-config.ts';
export { pendingQuestions } from './engine/decisions/pending-questions.ts';
export { openDispatch } from './engine/dispatch/internal/open-dispatch.ts';
export { FreezeError } from './engine/run/freezes.ts';
export { group, spill } from './engine/spill.ts';
export { hasText, sha256, VERSION } from './engine/util.ts';

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
