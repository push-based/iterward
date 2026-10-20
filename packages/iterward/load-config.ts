/**
 * The loop loader: it parses a JSON loop file, compiles it, resolves each hook `"<file>#<export>"` relative to
 * the loop file, and computes the configuration hash a run records, so a run refuses to go on
 * under a changed loop file or hook module.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileLoop, hookParts, keysOf, setAt } from './compile-loop.ts';
import type { LoopConfig, LoopFile } from './config.ts';

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

/** A comment, or a string, which the comment scan keeps whole so a `//` inside it starts no comment. */
const COMMENT = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
/**
 * A static import or re-export of a relative path, at the start of a line or after a `;`: `import './a.mts'`,
 * `import { a } from './a.mts'`, or `export * from './a.mts'`. An `import` inside a string, such as a stylesheet
 * line, isn't one, and neither is a path in an `export const`.
 */
const IMPORT = /(?:^|;)\s*(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

/** `entry` and the files it imports with relative static imports, transitively. */
function configFiles(entry: string): string[] {
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        // ponytail: a regex, not a parser; a regex literal that holds a quote or a backtick can hide the imports after it. Use a lexer if a hook module needs one.
        const code = readFileSync(file, 'utf8').replace(COMMENT, (m, str) => str ?? m.replace(/[^\n]/g, ''));
        for (const m of code.matchAll(IMPORT)) {
            const dep = resolve(dirname(file), m[1]);
            if (statSync(dep, { throwIfNoEntry: false })?.isFile()) visit(dep);
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
