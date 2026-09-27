import type { Route, Run } from '../../../config.mts';
import { type Ctx, hookCtx } from '../../context.mts';

/** The route's move at the initial state: a plan dispatch with its message values, or a gate the plan stage reaches with a plan dispatch for its refusal. */
export async function planMove(ctx: Ctx, runPath: string, run: Run): Promise<Awaited<ReturnType<Route>>> {
    const { cfg } = ctx;
    const move = await cfg.route(hookCtx(runPath, run));
    const stages = new Set(Object.values(cfg.byStatus));
    const dispatches = Object.keys(cfg.dispatches).filter((n) => !stages.has(n));
    const gates = cfg.states[cfg.initial].filter((s) => cfg.gates[s]);
    const known = (field: string, name: unknown, names: string[]) => {
        if (!names.includes(name as string)) throw new Error(`the route's ${field} ${name} is not one of ${names.join(', ') || 'none'}`);
    };
    if (move && 'gate' in move) {
        known('gate', move.gate, gates);
        known('onRefusal', move.onRefusal, dispatches);
    } else known('dispatch', move?.dispatch, dispatches);
    return move;
}
