import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Run } from '../../config.mts';
import type { Ctx } from '../context.mts';
import { projectionErrors } from '../decisions/projection-errors.mts';
import { now, sha256 } from '../util.mts';
import { guardCtx } from './internal/guard-ctx.mts';

/**
 * Store an artifact written at the initial state: refuse it unless its guard and the decision projection
 * accept it, then write it beside the run and record its ref. `dryRun` runs the checks and stores nothing.
 */
export function store(ctx: Ctx, runPath: string, run: Run, name: string, sourcePath: string, { dryRun = false }: { dryRun?: boolean } = {}): Run {
    const { cfg } = ctx;
    const spec = cfg.artifacts[name];
    if (!spec) throw new Error(`store takes ${Object.keys(cfg.artifacts).join(', ')}, not ${name}`);
    if (run.status !== cfg.initial) throw new Error(`store ${name} is only allowed at status ${cfg.initial}, not ${run.status}`);
    if (spec.requires) {
        const req = run.artifacts[spec.requires];
        if (!req || req.seq <= (run.artifacts[name]?.seq ?? 0)) throw new Error(`store ${name} needs this cycle's ${spec.requires}: run store ${spec.requires} first`);
    }
    const text = readFileSync(sourcePath, 'utf8');
    const doc = JSON.parse(text);
    const projection = spec.projection ? projectionErrors(ctx, run, doc).filter((e) => spec.projection === 'all' || !e.startsWith('active decision')) : [];
    const errs = [...(spec.guard?.(doc, guardCtx(run, runPath)) ?? []), ...projection];
    if (errs.length) throw new Error(`store ${name} refuses the ${name} (${errs.length} error(s)): ${errs.slice(0, 20).join('; ')}`);
    if (dryRun) return run;
    const dir = dirname(runPath);
    const prev = run.artifacts[name];
    let path = `${name}.stored.json`;
    let n = (prev?.n ?? 0) + 1;
    if (spec.store === 'versioned') {
        n = 1;
        while (existsSync(join(dir, `${name}.${n}.json`))) n++;
        path = `${name}.${n}.json`;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, path), text);
    run.seq = (run.seq ?? 0) + 1;
    run.artifacts[name] = { path, sha256: sha256(text), at: now(), n, seq: run.seq };
    (run.docs ??= {})[name] = doc;
    return run;
}
