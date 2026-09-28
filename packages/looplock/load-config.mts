/**
 * The loop loader: it parses a JSON loop file, compiles it, resolves each hook `"<file>#<export>"` relative to
 * the loop file, and computes the configuration hash a run records, so a run refuses to go on
 * under a changed loop file or hook module.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileLoop, hookParts, keysOf, setAt } from './compile-loop.mts';
import type { LoopConfig, LoopFile } from './config.mts';

/** Loads the loop file at `path`; throws on a loop the engine can't run, naming the place at fault. */
export async function loadLoop(path: string): Promise<LoopConfig> {
    let file: LoopFile;
    try {
        file = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        throw new Error(`loop file ${path}: ${(e as Error).message}`);
    }
    const config = compileLoop(file);
    const dir = dirname(resolve(path));
    for (const [pointer, ref] of Object.entries(config.hooks)) {
        const place = `loop ${config.name}, ${keysOf(pointer).join('.')}`;
        const { module, export: name } = hookParts(ref);
        let mod: Record<string, unknown>;
        try {
            mod = await import(pathToFileURL(resolve(dir, module)).href);
        } catch (e) {
            throw new Error(`${place}: ${module} can't be imported: ${String((e as Error).message).split('\n')[0]}`);
        }
        if (!Object.hasOwn(mod, name)) throw new Error(`${place}: ${module} has no export ${name}`);
        if (typeof mod[name] !== 'function') throw new Error(`${place}: ${module}'s export ${name} is not a function`);
        setAt(config, pointer, mod[name]);
    }
    config.sha256 = configHash(path, Object.values(config.hooks).map((r) => resolve(dir, hookParts(r).module)));
    return config;
}

/** `entry` and the files it imports with relative static imports, transitively. */
function configFiles(entry: string): string[] {
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        // Static import and export statements only: an `import` inside a string, such as a stylesheet line, isn't one.
        for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^;'"]*?(?:from\s*)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
            const dep = resolve(dirname(file), m[1]);
            if (existsSync(dep)) visit(dep);
        }
    };
    visit(resolve(entry));
    return [...seen];
}

/** One sha256 over the loop file and each hook module with its local imports, keyed by path relative to the loop file's folder. */
function configHash(path: string, modules: string[]): string {
    const base = dirname(resolve(path));
    const files = [...new Set([resolve(path), ...modules.flatMap(configFiles)])].sort();
    return createHash('sha256').update(files.map((f) => `${relative(base, f)}\0${readFileSync(f, 'utf8')}`).join('\0')).digest('hex');
}
