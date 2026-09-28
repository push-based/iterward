import { existsSync } from 'node:fs';

import type { DispatchInfo, Run } from '../../config.mts';
import { type Ctx, hookCtx, inRunDir } from '../context.mts';
import { pendingQuestions } from '../decisions/pending-questions.mts';
import { gateReady } from '../gates/internal/gate-ready.mts';
import { hasText, now } from '../util.mts';
import { checkFreezes, freeze } from './freezes.mts';
import { humanEdges, type RunEdge } from './human-edges.mts';

/** Why the status changes: a dispatch's outcome, the plan route entering a gate, a gate decision, or the `transition` command. */
export type Via = 'action' | 'route' | 'gate' | 'human';

/**
 * The one place the status changes. In order: the edge must be declared (a human move takes one of the state's
 * human edges); a human edge that drops a gate's freeze drops it; a human move into the initial state re-freezes
 * the answered questions at their files' current bytes, so a broken question freeze never traps the run; every
 * frozen file must be unchanged, or a FreezeError names it; entering the freezing gate other than by a decision
 * needs no pending question and runs the frozen artifacts' guards; leaving the initial state needs no pending
 * question; the target's validator runs. Only then is the move recorded. A refusal leaves the run to the caller, which saves it only after a command succeeds.
 */
export async function transition(ctx: Ctx, runPath: string, run: Run, to: string, { via, note, dispatch }: { via: Via; note?: string; dispatch?: DispatchInfo }): Promise<Run> {
    const { cfg } = ctx;
    const from = run.status;
    const human = via === 'human' || via === 'gate';
    let edge: RunEdge | undefined;
    if (via === 'human') {
        if (!hasText(note)) throw new Error('a human transition needs --note with the human\'s words, verbatim');
        const open = run.dispatches.at(-1);
        if (open && !open.closedAt) throw new Error(`dispatch ${open.id} (${open.agent}) is open: run result first`);
        const edges = humanEdges(ctx, run);
        edge = edges.find((e) => e.to === to);
        if (!edge) throw new Error(`${from} → ${to} is not a human move; from ${from} a human transition goes to ${edges.map((e) => e.to).join(', ') || 'no state'}`);
    } else {
        if (from === 'blocked' && to !== 'blocked') throw new Error(`a blocked run leaves only by a human transition, not ${from} → ${to}`);
        const allowed = cfg.states[from] ?? [];
        if (to !== 'blocked' && !allowed.includes(to)) throw new Error(`illegal transition ${from} → ${to} (allowed: ${allowed.join(', ') || 'none'})`);
        const gate = cfg.gates[from];
        if (gate && to === gate.next && run.gates[from]?.decision !== 'approved') throw new Error(`${from} → ${to} requires ${gate.label} approval; use gate ${from} --decision approved`);
        if (to === 'blocked' && !hasText(note)) throw new Error('a move to blocked needs a note stating the blockers, so the parked run can explain itself');
    }
    if (edge?.drops) {
        for (const [file, f] of Object.entries(run.freezes)) if (f.by === edge.drops) delete run.freezes[file];
        const g = run.gates[edge.drops];
        if (g) {
            delete g.decision;
            delete g.note;
            delete g.at;
        }
    }
    if (human && to === cfg.initial) {
        // The ledger stays the authority: the target's validator judges a question file that now disagrees with it.
        const asked = new Set(run.questions.map((q) => q.id));
        for (const [file, f] of Object.entries(run.freezes)) {
            if (!asked.has(f.by)) continue;
            if (existsSync(inRunDir(runPath, file))) freeze(runPath, run, file, f.by);
            else delete run.freezes[file];
        }
    }
    if (to !== 'blocked') {
        checkFreezes(ctx, runPath, run);
        if (to === cfg.freezeGate && via !== 'gate') await gateReady(ctx, runPath, run, to, 'enter', dispatch);
        const pending = from === cfg.initial ? pendingQuestions(run) : [];
        if (pending.length) throw new Error(`leaving ${from} needs every question answered; pending: ${pending.map((q) => q.id).join(', ')}`);
        const errors = (await cfg.validators[to]?.({ ...hookCtx(runPath, run), from, to, human, ...(dispatch ? { dispatch } : {}) })) ?? [];
        if (errors.length) throw new Error(errors.join('\n'));
    }
    if (to === 'blocked' && from !== 'blocked') run.blockedFrom = from;
    run.history.push({ from, to, at: now(), ...(hasText(note) ? { note } : {}), ...(human ? { human: true as const } : {}) });
    run.status = to;
    if (to !== 'blocked') delete run.blockedFrom;
    return run;
}
