import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mcpToolsOf, mcpToolName } from '@substrat-run/vertical-host';
import type { ScopeStub } from '@substrat-run/kernel';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';

import { operations } from '../src/model.js';
import { buildStrideHost, seedStride, type StrideWorld } from '../src/seed.js';

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

  /**
   * THE ONE THAT WOULD HAVE CAUGHT IT.
   *
   * An MCP call has no path and no query string — the whole input arrives as
   * `arguments`. So an operation that reads `{programId}` off its path over
   * HTTP and declares no `input` renders as a tool with NO properties at all:
   * a client with nothing to fill in sends nothing, `mountMcp` invokes with
   * `undefined` because the declaration says the operation takes no input, and
   * the handler's own `parse` refuses it. The tool cannot be called at all —
   * with arguments or without — and every other gate in this repo stays green,
   * because the scenario suite calls operations directly and the HTTP mount
   * fills those fields in from the path.
   *
   * Twenty-two of them were in that state. What makes this checkable without a
   * second list to maintain: a `{var}` in a path IS an input field by
   * declaration, so the published schema must name every one of them.
   */
  it('publishes every path parameter as a field of the tool', () => {
    const wrong: string[] = [];
    for (const tool of tools) {
      const op = operations[tool.operation as keyof typeof operations] as { http: { path: string } };
      const params = [...op.http.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (params.length === 0) continue;
      const schema = tool.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const properties = Object.keys(schema.properties ?? {});
      const required = schema.required ?? [];
      for (const param of params) {
        if (!properties.includes(param)) wrong.push(`${tool.name} does not publish ${param}`);
        else if (!required.includes(param)) wrong.push(`${tool.name} publishes ${param} as optional`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The other half: a tool that publishes fields must actually take them.
   *
   * `takesInput` is what decides whether `mountMcp` hands the operation the
   * caller's arguments or `undefined`, so a schema and a `false` there would be
   * a tool describing an input it then throws away.
   */
  it('takes input wherever it publishes any', () => {
    const lying = tools
      .filter((t) => Object.keys((t.inputSchema as { properties?: object }).properties ?? {}).length > 0)
      .filter((t) => !t.takesInput && !t.paged)
      .map((t) => t.operation);
    expect(lying).toEqual([]);
  });
});

/**
 * And the same thing proved rather than derived: every tool, invoked the way
 * `mountMcp` invokes it, against a real seeded scope.
 *
 * A structural check can only compare two declarations to each other. This one
 * builds the payload exactly as the endpoint does — the caller's arguments when
 * the operation declares an input, `undefined` when it does not — and asserts
 * that what comes back is never the refusal that says the call could not be
 * made at all. Denials, missing rows and missing FIELDS are all fine and
 * expected here: they are answers. `invalid_type` at the ROOT is not, because
 * it means the operation was handed nothing and no argument could have helped.
 */
describe('every tool can actually be called', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let astrid: ScopeStub;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-training-mcp-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    astrid = await host.getScope(w.astrid, w.t1, w.s1);
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never answers a bare call with "expected object, received undefined"', async () => {
    const unreachable: string[] = [];
    for (const tool of tools) {
      // `payloadOf` in `mountMcp`, in the two lines that matter: an operation
      // declaring no input is invoked with `undefined` — unconditionally, so a
      // hallucinated argument cannot make it see a different input than it
      // would over the wire — and everything else gets the arguments given.
      const payload = tool.takesInput ? { ...tool.pinned } : undefined;
      try {
        await astrid.invoke(tool.operation, payload as never);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Zod's root-level complaint, in either spelling it has used.
        if (/received undefined/.test(message) && /"path": \[\]|"path":\[\]/.test(message)) {
          unreachable.push(tool.name);
        }
      }
    }
    expect(unreachable).toEqual([]);
  });
});
