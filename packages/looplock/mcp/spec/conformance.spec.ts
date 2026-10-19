/**
 * node --test mcp/spec/conformance.spec.ts
 *
 * Proves that the official MCP client of `@modelcontextprotocol/sdk` works with the server started as
 * `looplock mcp`: it negotiates the client's latest protocol, accepts the tool list, and reads a tool result and a
 * refusal. The SDK checks every reply against its own schemas, so a reply that breaks the protocol fails here.
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { BIN, startedRun } from './fixtures.ts';

test('the SDK client connects at its latest protocol, lists the tools, and reads a result and a refusal', async () => {
    const transport: Transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'] });
    // The client hands the negotiated version to a transport that takes it; stdio doesn't, so record it here.
    let negotiated: string | undefined;
    transport.setProtocolVersion = (v) => (negotiated = v);
    const client = new Client({ name: 'conformance', version: '0' });
    await client.connect(transport);
    after(() => client.close());
    assert.deepEqual([negotiated, client.getServerVersion()?.name], [LATEST_PROTOCOL_VERSION, 'looplock']);
    assert.match(client.getInstructions() ?? '', /`build-loop`/);

    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'show'));

    const run = startedRun();
    const text = (res: Awaited<ReturnType<Client['callTool']>>) => (res.content as { text: string }[])[0].text;
    const shown = await client.callTool({ name: 'show', arguments: { run } });
    assert.deepEqual([shown.isError, JSON.parse(text(shown)).status], [undefined, 'discovery']);
    const refused = await client.callTool({ name: 'transition', arguments: { run, to: 'plan', note: ' ' } });
    assert.deepEqual([refused.isError, text(refused).startsWith('transition refused:')], [true, true]);
});
