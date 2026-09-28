/**
 * node --test mcp/spec/server.spec.mts
 *
 * Proves the MCP server's contract: the handshake, one tool per CLI command, and a tool call routed to its
 * tool, over stdio.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { asArguments } from '../tools.mts';
import { BIN, startedRun } from './fixtures.mts';

const SERVER = fileURLToPath(new URL('../server.mts', import.meta.url));

/** A server process, and `call` for a request's reply. */
function server() {
    const proc = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
    after(() => proc.kill());
    const waiting = new Map<number, (msg: any) => void>();
    createInterface({ input: proc.stdout }).on('line', (line) => {
        const msg = JSON.parse(line);
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
    });
    let id = 0;
    const call = (method: string, params?: object) =>
        new Promise<any>((done) => {
            waiting.set(++id, done);
            proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
    return { call };
}

test('the handshake names the server, and tools/list lists the 8 tools, one per CLI command but compile', async () => {
    const s = server();
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '0' } });
    assert.deepEqual([init.result.protocolVersion, init.result.serverInfo.name], ['2025-06-18', 'looplock']);
    assert.equal((await s.call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
    const commands = spawnSync(process.execPath, [BIN], { encoding: 'utf8' }).stderr.match(/<(.+)>/)![1].split('|');
    const { tools } = (await s.call('tools/list')).result;
    assert.deepEqual(tools.map((t: any) => t.name), ['new', 'next', 'result', 'show', 'validate', 'answer', 'gate', 'transition']);
    // `compile` prints a loop for its author; no agent needs it, so the server leaves it out.
    assert.deepEqual(tools.map((t: any) => t.name), commands.filter((c) => c !== 'compile'));
    assert.deepEqual(tools.filter((t: any) => t.annotations.readOnlyHint).map((t: any) => t.name), ['show']);
    assert.equal((await s.call('bogus')).error.code, -32601);
});

test('tools/call returns the tool result, and refuses a tool that does not exist', async () => {
    const s = server();
    const res = (await s.call('tools/call', { name: 'show', arguments: {} })).result;
    assert.deepEqual([res.isError, res.content[0].text], [true, 'show malformed call: run is required']);
    assert.equal((await s.call('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
});

test('a refusal names each tool argument as the tool takes it, not as a CLI flag, and leaves a custom property whole', () => {
    assert.equal(asArguments('a human transition needs --note; --answers takes a JSON array; --to'), 'a human transition needs `note`; `answers` takes a JSON array; `to`');
    assert.equal(asArguments('--ds-pr-x-note and --note-x and x--note stay'), '--ds-pr-x-note and --note-x and x--note stay');
});

test('a tool call that the CLI refuses comes back with the tool arguments named', async () => {
    const s = server();
    await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '0' } });
    const res = await s.call('tools/call', { name: 'transition', arguments: { run: startedRun(), to: 'plan', note: ' ' } });
    assert.deepEqual([res.result.isError, res.result.content[0].text], [true, "transition refused: other:\n  - a human transition needs `note` with the human's words, verbatim"]);
});
