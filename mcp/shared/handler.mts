import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The CLI beside this module, with this module's own extension, so a built copy runs `bin.mjs`. */
const EXT = import.meta.url.slice(import.meta.url.lastIndexOf('.'));
export const BIN = fileURLToPath(new URL(`../../bin${EXT}`, import.meta.url));

/** A JSON Schema property, as far as the tools use it. */
export interface Prop {
    type: 'string' | 'boolean' | 'array' | 'object' | 'integer';
    minimum?: number;
    description?: string;
    enum?: readonly string[];
    items?: Prop;
    additionalProperties?: Prop;
}

export interface ToolSchema {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, Prop>; required?: readonly string[]; additionalProperties: false };
    annotations: { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
}

export type Params = Record<string, any>;
export interface ToolResult {
    content: { type: 'text'; text: string }[];
    isError?: true;
}
export interface Tool {
    schema: ToolSchema;
    handler: (params: Params) => Promise<ToolResult>;
}

/** `--key value` for each string, `--key a,b` for each list, and `--key` for each true switch; a camelCase key becomes a kebab-case flag. */
export function flags(params: Params, skip: string[] = []): string[] {
    return Object.entries(params)
        .filter(([k, v]) => !skip.includes(k) && v != null && v !== false)
        .flatMap(([k, v]) => {
            const flag = `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            return v === true ? [flag] : [flag, Array.isArray(v) ? v.join(',') : String(v)];
        });
}

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** The errors of one value against its property: the wrong type, a value outside the enum, or a bad item. */
function check(v: unknown, p: Prop, at: string): string[] {
    if (p.type === 'integer') return Number.isInteger(v) && (v as number) >= (p.minimum ?? -Infinity) ? [] : [`${at} must be an integer${p.minimum == null ? '' : ` from ${p.minimum}`}`];
    if (typeOf(v) !== p.type) return [`${at} must be ${p.type === 'array' ? 'an' : 'a'} ${p.type}`];
    if (p.enum && !p.enum.includes(v as string)) return [`${at} must be one of ${p.enum.join(', ')}`];
    if (p.items) return (v as unknown[]).flatMap((x, i) => check(x, p.items!, `${at}[${i}]`));
    if (p.additionalProperties) return Object.entries(v as object).flatMap(([k, x]) => check(x, p.additionalProperties!, `${at}.${k}`));
    return [];
}

/** The errors of the arguments against a tool's input schema: a missing required argument, an unknown one, or a bad value. */
function invalid({ properties, required = [] }: ToolSchema['inputSchema'], params: Params): string[] {
    return [
        ...required.filter((k) => params[k] == null).map((k) => `${k} is required`),
        ...Object.entries(params).flatMap(([k, v]) => (properties[k] ? check(v, properties[k], k) : [`unknown argument ${k}`])),
    ];
}

/** One CLI command in its own process, so every call reads the loop's configuration again, as the CLI does. */
function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((done) =>
        execFile(process.execPath, [BIN, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
            done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }),
        ),
    );
}

const error = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

/**
 * A tool's handler: checks the arguments against the schema, runs the CLI command that `argv` builds from
 * them, and returns the command's JSON line. A refusal (exit 2) and a malformed call (exit 1, or arguments
 * the schema refuses) come back as error results, with the reason.
 */
export function createHandler(schema: ToolSchema, argv: (params: Params) => string[]) {
    return async (params: Params): Promise<ToolResult> => {
        const errs = invalid(schema.inputSchema, params);
        if (errs.length) return error(`${schema.name} malformed call: ${errs.join('; ')}`);
        const res = await cli(argv(params));
        if (res.code === 0) return { content: [{ type: 'text', text: res.stdout.trim() }] };
        return error(`${schema.name} ${res.code === 2 ? 'refused' : 'malformed call'}: ${res.stderr.trim()}`);
    };
}
