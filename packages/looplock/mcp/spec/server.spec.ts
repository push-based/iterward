/**
 * node --test mcp/spec/server.spec.ts
 *
 * Proves the MCP server's contract: `looplock mcp` starts it, the handshake, one tool per CLI command, and a
 * tool call routed to its tool, over stdio.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { after, test } from 'node:test';

import { asArguments } from '../tools.ts';
import { BIN, startedRun } from './fixtures.ts';

/** A server process, started as `looplock mcp`, and `call` for a request's reply. */
function server() {
    const proc = spawn(process.execPath, [BIN, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
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

test('the handshake names the server and points at build-loop, and tools/list lists one tool per CLI command but dispatch', async () => {
    const s = server();
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '0' } });
    assert.deepEqual([init.result.protocolVersion, init.result.serverInfo.name], ['2025-06-18', 'looplock']);
    assert.match(init.result.instructions, /call `build-loop` first/);
    assert.equal((await s.call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
    const commands = spawnSync(process.execPath, [BIN], { encoding: 'utf8' }).stderr.match(/<(.+)>/)![1].split('|').filter((c) => c !== 'mcp');
    const { tools } = (await s.call('tools/list')).result;
    assert.deepEqual(tools.map((t: any) => t.name), ['init', 'build-loop', 'compile', 'new', 'next', 'result', 'show', 'validate', 'answer', 'gate', 'transition']);
    // `dispatch` serves a harness's watcher through the CLI; no agent needs it.
    assert.deepEqual(tools.map((t: any) => t.name), commands.filter((c) => c !== 'dispatch'));
    assert.deepEqual(tools.filter((t: any) => t.annotations.readOnlyHint).map((t: any) => t.name), ['build-loop', 'compile', 'show']);
    assert.equal((await s.call('bogus')).error.code, -32601);
    assert.equal((await s.call('constructor', { a: 1 })).error.code, -32601, 'a member every object has is no method');
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
