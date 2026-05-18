import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgent, recordEntry } from '@modexagents/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createServer, SERVER_NAME, SERVER_VERSION } from '../src/index.js';

// Drive the real McpServer through an in-memory client pair. This proves the
// full tool wiring — tool listing over the protocol, argument validation,
// dispatch into core's run* ops, and the error envelope — without spawning
// a subprocess or touching stdio.

const EXPECTED_TOOLS = [
  'modex_agents_create',
  'modex_agents_list',
  'modex_aspirations_add',
  'modex_aspirations_list',
  'modex_bind',
  'modex_cite',
  'modex_eval_add',
  'modex_eval_list',
  'modex_eval_results',
  'modex_eval_run',
  'modex_feed',
];

async function makeClientPair(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'modex-mcp-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('modex-mcp server', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalXdg: string | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalXdg = process.env['XDG_CONFIG_HOME'];
    tmpDir = await mkdtemp(join(tmpdir(), 'modex-mcp-'));
    process.chdir(tmpDir);
    // Redirect credential lookups away from the developer's real
    // ~/.config/modex so the bind test reliably hits "no credentials" and
    // can't accidentally make a network call.
    process.env['XDG_CONFIG_HOME'] = join(tmpDir, 'xdg');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalXdg === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = originalXdg;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('advertises every modex tool', async () => {
    const client = await makeClientPair();
    const result: ListToolsResult = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('reports the server name and version', async () => {
    const client = await makeClientPair();
    const info = client.getServerVersion();
    expect(info?.name).toBe(SERVER_NAME);
    expect(info?.version).toBe(SERVER_VERSION);
  });

  it('routes modex_agents_list through core and returns the populated list', async () => {
    const agent = await createAgent({ baseDir: tmpDir, name: 'demo' });
    const client = await makeClientPair();
    const result = (await client.callTool({
      name: 'modex_agents_list',
      arguments: {},
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const first = result.content[0]!;
    expect(first.type).toBe('text');
    const payload = JSON.parse((first as { text: string }).text);
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0].agentId).toBe(agent.config.id);
    expect(payload.agents[0].name).toBe('demo');
  });

  it('routes modex_aspirations_list through core and returns the populated list', async () => {
    // Local-only op (no fetch needed) so it's the cleanest end-to-end check
    // that the Phase F/G/H wiring through MCP actually dispatches to core.
    const agent = await createAgent({ baseDir: tmpDir, name: 'cited' });
    const provenanceFile = join(tmpDir, '.modex', agent.config.id, 'provenance.jsonl');
    await recordEntry({
      path: provenanceFile,
      draft: {
        kind: 'aspiration_added',
        input: {
          aspiration_sha256: 'a'.repeat(64),
          aspiration_bytes: 10,
          source: 'honesty.md',
        },
        output: { registry_url: 'https://registry.example' },
      },
      ts: '2026-05-18T01:00:00.000Z',
    });

    const client = await makeClientPair();
    const result = (await client.callTool({
      name: 'modex_aspirations_list',
      arguments: { agentId: agent.config.id },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.agentId).toBe(agent.config.id);
    expect(payload.aspirations).toHaveLength(1);
    expect(payload.aspirations[0].source).toBe('honesty.md');
  });

  it('routes modex_cite errors back to the client as isError replies', async () => {
    // No credentials → CredentialsError → user-facing → isError reply.
    const agent = await createAgent({ baseDir: tmpDir, name: 'cite-target' });
    const client = await makeClientPair();
    const result = (await client.callTool({
      name: 'modex_cite',
      arguments: { agentId: agent.config.id },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^error: /);
    expect(text).toMatch(/login/i);
  });

  it('returns an isError reply when bind is invoked without credentials', async () => {
    // No login → loadCredentials returns null → runBind throws CredentialsError,
    // which isUserFacingError() recognizes. The MCP envelope should surface it
    // as a structured tool error, not a protocol-level crash.
    const agent = await createAgent({ baseDir: tmpDir, name: 'unbound' });
    const client = await makeClientPair();
    const result = (await client.callTool({
      name: 'modex_bind',
      arguments: { agentId: agent.config.id },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/^error: /);
    expect(text).toMatch(/login/i);
  });
});
