#!/usr/bin/env node
/**
 * looplock MCP server — the CLI's commands as Model Context Protocol tools, over stdio. Each tool call runs
 * one CLI command in its own process, so the tools refuse what the CLI refuses. Start it with `looplock mcp`
 * from the repository root, as the CLI.
 *
 * It answers `initialize`, `ping`, `tools/list`, and `tools/call`, one request at a time, and ignores
 * notifications. Every line on stdout is one JSON-RPC message.
 */

import { createInterface } from 'node:readline';

import { VERSION } from '../engine.ts';
import { TOOLS, asArguments } from './tools.ts';

/** The protocol versions the server speaks. It answers a version it doesn't know with the first. */
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });

const METHODS: Record<string, (params: any) => unknown> = {
    initialize: (p) => ({
        protocolVersion: PROTOCOLS.includes(p?.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'looplock', version: VERSION },
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS.map((t) => t.schema) }),
    'tools/call': (p) => {
        const tool = TOOLS.find((t) => t.schema.name === p?.name);
        if (!tool) throw rpcError(-32602, `no tool ${p?.name}; the tools are ${TOOLS.map((t) => t.schema.name).join(', ')}`);
        return tool.handler(p.arguments ?? {}).then((res) => (res.isError ? { ...res, content: res.content.map((c) => ({ ...c, text: asArguments(c.text) })) } : res));
    },
};

/** The reply to one message, or nothing for a notification. */
async function reply(line: string): Promise<object | undefined> {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'a message must be one line of JSON' } };
    }
    if (msg?.id == null || typeof msg.method !== 'string') return;
    const fn = METHODS[msg.method];
    if (!fn) return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } };
    try {
        return { jsonrpc: '2.0', id: msg.id, result: await fn(msg.params) };
    } catch (e) {
        return { jsonrpc: '2.0', id: msg.id, error: { code: (e as any).code ?? -32603, message: (e as Error).message } };
    }
}

// One request at a time: two commands on one run must not interleave their load and save.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
        const out = await reply(line);
        if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    });
});
