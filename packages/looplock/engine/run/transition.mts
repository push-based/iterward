import { existsSync } from 'node:fs';

import type { DispatchInfo, Run } from '../../config.mts';
import { type Ctx, hookCtx, inRunDir } from '../context.mts';
import { gateReady } from '../gates/internal/gate-ready.mts';
import { hasText, now } from '../util.mts';
import { checkFreezes, dropsOf, freeze } from './freezes.mts';
import { humanEdges } from './human-edges.mts';

/** Why the status changes: an outcome the machine maps, a gate decision, or the `transition` command. */
export type Via = 'machine' | 'gate' | 'human';

/**
 * The one place the status changes. In order: a human move takes one of the state's human moves, and a machine
 * move never leaves `blocked`; a human move or a gate decision into a step that writes a frozen artifact drops
 * that gate's freeze and decision, and re-freezes the answered questions at their files' current bytes, so a
 * broken question freeze never traps the run; every frozen file must be unchanged, or a FreezeError names it;
 * entering a gate needs no pending question and runs the frozen artifacts' guards; the target's `onEnter` runs.
 * Only then is the move recorded. A refusal leaves the run to the caller, which saves it only after a command succeeds.
 */
export async function transition(ctx: Ctx, runPath: string, run: Run, to: string, { via, note, dispatch }: { via: Via; note?: string; dispatch?: DispatchInfo }): Promise<Run> {
    const { cfg } = ctx;
    const from = run.status;
    const human = via !== 'machine';
    if (via === 'human') {
        if (!hasText(note)) throw new Error('a human transition needs --note with the human\'s words, verbatim');
        const open = run.dispatches.at(-1);
        if (open && !open.closedAt) throw new Error(`dispatch ${open.id} (${open.agent}) is open: run result first`);
        const edges = humanEdges(ctx, run);
        if (!edges.some((e) => e.to === to)) throw new Error(`${from} → ${to} is not a human move; from ${from} a human transition goes to ${edges.map((e) => e.to).join(', ') || 'no state'}`);
    } else if (from === 'blocked' && to !== 'blocked') throw new Error(`a blocked run leaves only by a human transition, not ${from} → ${to}`);
    if (to === 'blocked' && !hasText(note)) throw new Error('a move to blocked needs a note stating the blockers, so the parked run can explain itself');
    if (human) {
        const drops = dropsOf(ctx, run, to);
        if (drops) {
            for (const [file, f] of Object.entries(run.freezes)) if (f.by === drops) delete run.freezes[file];
            const g = run.gates[drops];
            if (g) {
                delete g.decision;
                delete g.note;
                delete g.at;
            }
        }
        // The ledger stays the authority: the guard judges a question file that now disagrees with it.
        const asked = new Set(run.questions.map((q) => q.id));
        for (const [file, f] of Object.entries(run.freezes)) {
            if (!asked.has(f.by)) continue;
            if (existsSync(inRunDir(runPath, file))) freeze(runPath, run, file, f.by);
            else delete run.freezes[file];
        }
    }
    if (to !== 'blocked') {
        checkFreezes(ctx, runPath, run);
        if (cfg.gates[to]) await gateReady(ctx, runPath, run, to, 'enter', dispatch);
        const onEnter = (cfg.steps[to] ?? cfg.gates[to] ?? cfg.stops[to])?.onEnter;
        const errors = (await onEnter?.({ ...hookCtx(runPath, run), from, to, human, ...(dispatch ? { dispatch } : {}) })) ?? [];
        if (errors.length) throw new Error(errors.join('\n'));
    }
    if (to === 'blocked' && from !== 'blocked') run.blockedFrom = from;
    run.history.push({ from, to, at: now(), ...(hasText(note) ? { note } : {}), ...(human ? { human: true as const } : {}) });
    run.status = to;
    if (to !== 'blocked') delete run.blockedFrom;
    return run;
}
