import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mcpToolsOf, mcpToolName, mountOperations } from '@substrat-run/vertical-host';
import { Hono } from 'hono';
import type { ScopeStub } from '@substrat-run/kernel';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';

import { knownOperations, operations } from '../src/model.js';
import type { ProgramCard, ProgramDetail, ProgressView, SessionRow, ItemRow, TraineeRow } from '../src/module.js';
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

// Exercise the transport itself: never reproduce mountMcp's payload logic here.
// The resolver supplies a test identity; authentication is the harness's job.
describe('MCP JSON-RPC reads logged training', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let adminApp: Hono;
  let strangerApp: Hono;
  let traineeId: string;
  let programId: string;
  let sessionId: string;
  let exerciseId: string;
  let requestId = 0;

  async function rpc(app: Hono, method: string, params: object = {}) {
    const response = await app.request('/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    });
    expect(response.status).toBe(200);
    const envelope = await response.json() as {
      error?: unknown;
      result: { isError?: boolean; content: { text: string }[]; structuredContent: unknown; tools: typeof tools };
    };
    expect(envelope.error).toBeUndefined();
    return envelope.result;
  }

  async function call(app: Hono, operation: string, args: object = {}) {
    return rpc(app, 'tools/call', { name: mcpToolName(operation), arguments: args });
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stride-mcp-wire-'));
    host = buildStrideHost(dir);
    const w = await seedStride(host, dir);
    const admin = await host.getScope(w.astrid, w.t1, w.s1);
    const stranger = await host.getScope(w.bjorn, w.t1, w.s1);
    adminApp = new Hono();
    strangerApp = new Hono();
    mountOperations(adminApp, operations, async () => admin, { basePath: '/api', knownOperations });
    mountOperations(strangerApp, operations, async () => stranger, { basePath: '/api', knownOperations });
    const trainee = await admin.invoke('stride/train-myself', {}) as TraineeRow;
    traineeId = trainee.id;
    const program = await admin.invoke('stride/assign-program', {
      traineeId, title: 'MCP baseline', kind: 'assessment',
    }) as { program: ProgramCard };
    programId = program.program.id;
    exerciseId = w.squatId;
    const item = await admin.invoke('stride/add-program-item', {
      programId, exerciseId, targetSets: 2, targetReps: 10, targetLoad: '20',
    }) as ItemRow;
    await admin.invoke('workorder/start', { orderId: programId });
    const session = await admin.invoke('stride/log-session', { programId }) as SessionRow;
    sessionId = session.id;
    for (const reps of [10, 8]) {
      await admin.invoke('stride/log-set', { sessionId, programItemId: item.id, reps, load: '20' });
    }
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes typed, required ids at the top level through tools/list', async () => {
    const listed = await rpc(adminApp, 'tools/list');
    for (const [operation, field] of [['stride/get-program', 'programId'], ['stride/progress', 'traineeId']]) {
      const tool = listed.tools.find((t) => t.name === mcpToolName(operation));
      expect(tool?.inputSchema).toMatchObject({
        type: 'object', required: [field],
        properties: { [field]: { type: 'string', minLength: 1, description: expect.any(String) } },
      });
    }
  });

  it('follows whoami → my-programs → get-program → progress using real logged sets', async () => {
    const me = await call(adminApp, 'stride/whoami');
    expect(me.structuredContent).toMatchObject({ role: 'admin', traineeId });
    const list = await call(adminApp, 'stride/my-programs');
    expect(JSON.parse(list.content[0].text)).toContainEqual(expect.objectContaining({
      id: programId, status: 'in_progress', setsLogged: 2,
    }));
    const detail = await call(adminApp, 'stride/get-program', { programId });
    expect(detail.isError).not.toBe(true);
    const workout = detail.structuredContent as ProgramDetail;
    expect(workout.program.id).toBe(programId);
    expect(workout.items[0].exercise).toMatchObject({ id: exerciseId, name: expect.any(String) });
    expect(workout.sessions).toHaveLength(1);
    expect(workout.sessions[0].sets.map((set) => ({ reps: set.reps, load: set.load })))
      .toEqual([{ reps: 10, load: '20' }, { reps: 8, load: '20' }]);
    const progress = await call(adminApp, 'stride/progress', { traineeId });
    expect(progress.isError).not.toBe(true);
    const curve = progress.structuredContent as ProgressView;
    expect(curve.sessionsSeen).toBe(1);
    expect(curve.exercises).toHaveLength(1);
    expect(curve.exercises[0]).toMatchObject({ exerciseId, name: workout.items[0].exercise!.name });
    expect(curve.exercises[0].series[0].points).toEqual([expect.objectContaining({
      sessionId, programId, sets: 2, bestReps: 10, bestLoad: '20', totalQuantity: 18, volume: '360',
    })]);
  });

  it('names the missing field for empty and incorrectly wrapped arguments', async () => {
    for (const [operation, field, args] of [
      ['stride/get-program', 'programId', {}],
      ['stride/get-program', 'programId', { input: { programId } }],
      ['stride/progress', 'traineeId', {}],
    ] as const) {
      const result = await call(adminApp, operation, args);
      expect(result.isError).toBe(true);
      const issues = JSON.parse(result.content[0].text) as { path: string[]; message: string }[];
      expect(issues).toContainEqual(expect.objectContaining({ path: [field], message: expect.any(String) }));
      expect(issues.every((issue) => issue.path.length > 0)).toBe(true);
    }
  });

  it('denies another trainee the workout and excludes its sets from their progress view', async () => {
    const detail = await call(strangerApp, 'stride/get-program', { programId });
    expect(detail.isError).toBe(true);
    expect(detail.content[0].text).toContain('permission denied');
    const progress = await call(strangerApp, 'stride/progress', { traineeId });
    expect(progress.isError).not.toBe(true);
    expect(progress.structuredContent).toMatchObject({ sessionsSeen: 0, exercises: [] });
  });
});
