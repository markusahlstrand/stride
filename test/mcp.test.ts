import { describe, it, expect } from 'vitest';
import { mcpToolsOf, mcpToolName } from '@substrat-run/vertical-host';

import { operations } from '../src/model.js';

// ============================================================================
// THE MCP SURFACE, held to the same declarations the routes come from.
//
// A vertical that mounts its operations HAS an MCP endpoint — `mountOperations`
// renders one without being asked, off the same `http` declarations. That makes
// it the easiest surface in the app to break by accident: nothing here is
// written by hand, so nothing fails loudly when a declaration stops being good
// enough to render from.
//
// These are the two things a derivation cannot check for itself.
// ============================================================================

const tools = mcpToolsOf(operations);

describe('the MCP tool surface', () => {
  /**
   * Every tool needs a sentence, and the fallback is SILENT.
   *
   * Without `summary`, `mcpToolsOf` falls back to the operation NAME — so a new
   * operation renders as `stride/whatever` and an agent has to guess what it
   * does from a path. That passes every other gate in this repo: it typechecks,
   * it routes, it lints. This is the only thing that notices.
   */
  it('gives every tool a description that is not just its name', () => {
    const nameless = tools
      .filter((t) => t.description === t.operation || t.description.trim() === '')
      .map((t) => t.operation);
    expect(nameless).toEqual([]);
  });

  /**
   * `mcpToolsOf` throws on a collision rather than letting two operations render
   * as one tool, so this asserts the derivation RAN and produced the whole set —
   * a test that only checked "no collisions" would pass just as well on zero
   * tools, which is the failure it is supposed to catch.
   */
  it('renders one tool per declared route, with distinct names', () => {
    const routed = Object.entries(operations).filter(
      ([, op]) => (op as { http?: unknown; mcp?: unknown }).http && (op as { mcp?: unknown }).mcp !== false,
    );
    expect(tools).toHaveLength(routed.length);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    expect(tools.length).toBeGreaterThan(0);
  });

  /** A `/` in a tool name is rejected by some clients and mangled by others. */
  it('names tools in the character class clients accept', () => {
    for (const tool of tools) expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(mcpToolName('stride/log-set')).toBe('stride_log-set');
  });

  /**
   * A read is not destructive and a write is not a read. The hints come off the
   * HTTP method, so this is really a check that the METHODS are honest — a POST
   * declared for something that only reads would tell an agent to be careful
   * about a question it can ask freely.
   */
  it('marks reads read-only and writes not', () => {
    const readOnly = tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.operation);
    expect(readOnly).toContain('stride/whoami');
    expect(readOnly).toContain('stride/progress');
    expect(readOnly).not.toContain('stride/log-set');
    expect(readOnly).not.toContain('stride/void-set');
  });
});
