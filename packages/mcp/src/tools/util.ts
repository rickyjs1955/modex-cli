import { isUserFacingError } from '@modexagents/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// MCP tool result helpers shared by every tool wrapper.
//
// Each modex `run*` op writes human progress to stdout/stderr. Over MCP we
// don't want that noise on the host's stderr — we capture it and fold the
// final transcript into the tool response. The structured result object goes
// in as JSON; the captured text follows so a model client can see exactly
// what the user would have seen in a terminal.

// Re-exported for tests; the SDK's CallToolResult is what tool callbacks must
// return. Using it directly (instead of a local alias) keeps us aligned with
// the protocol shape across SDK upgrades.
export type ToolResult = CallToolResult;

// Minimal WritableStream-compatible buffer. We only need .write — none of the
// run* ops touch end / cork / drain / event listeners. Keeping it tiny means
// we don't have to depend on node:stream just to satisfy the type.
class StringSink {
  private chunks: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }

  text(): string {
    return this.chunks.join('');
  }
}

export interface CapturedStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  text(): string;
}

// Capture both stdout and stderr into one interleaved transcript. Order
// across the two streams isn't preserved (each is its own buffer), but for
// these short ops that's not load-bearing — clients want the bytes, not the
// interleaving.
export function captureStreams(): CapturedStreams {
  const out = new StringSink();
  const err = new StringSink();
  return {
    stdout: out as unknown as NodeJS.WritableStream,
    stderr: err as unknown as NodeJS.WritableStream,
    text(): string {
      const o = out.text();
      const e = err.text();
      if (o.length === 0) return e;
      if (e.length === 0) return o;
      return `${o}\n${e}`;
    },
  };
}

// Format a structured result + captured stream text as a single tool reply.
// Two text blocks: JSON for machines, transcript for humans. MCP clients
// surface both; models typically read the JSON, users read the transcript.
export function okResult(result: unknown, transcript: string): ToolResult {
  const content: ToolResult['content'] = [
    { type: 'text', text: JSON.stringify(result, null, 2) },
  ];
  if (transcript.length > 0) {
    content.push({ type: 'text', text: transcript });
  }
  return { content };
}

// Translate exceptions from a run* op into an MCP error reply. User-facing
// errors (bad input, auth needed, registry rejection) become structured tool
// errors so the model can react; internal errors re-throw so the MCP server's
// own error handling surfaces them as a protocol-level failure.
export function mapToolError(err: unknown): ToolResult {
  if (isUserFacingError(err)) {
    return {
      content: [{ type: 'text', text: `error: ${err.message}` }],
      isError: true,
    };
  }
  throw err;
}
