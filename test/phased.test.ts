import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { SqliteScopeHost } from '@substrat-run/adapter-sqlite';
import { manualClock, type ScopeStub } from '@substrat-run/kernel';
import { Hono } from 'hono';
import { mountOperations, mcpToolName } from '@substrat-run/vertical-host';
import { MODULES, seedStride, type StrideWorld } from '../src/seed.js';
import { operations, knownOperations } from '../src/model.js';
import { sequencePlan, dateInZone, shiftDate, type SequencePlan } from '../src/phased-plan.js';
import type { PhasedProgramView } from '../src/phased.js';
import type { ProgramDetail, ProgressView, ProgramSummaryRow, SetResultRow } from '../src/module.js';

describe('phased programmes: snapshots, calendar, achievements and isolation', () => {
  const clock = manualClock('2026-03-28T11:00:00.000Z');
  let dir: string, host: SqliteScopeHost, w: StrideWorld, vera: ScopeStub, bjorn: ScopeStub, nina: ScopeStub, ola: ScopeStub;
  let plan: SequencePlan, templateId: string, programId: string, loggedSet: string;
  const invoke = <T = unknown>(who: ScopeStub, op: string, input?: unknown) => who.invoke<T>(`stride/${op}`, input as never);
  const view = () => invoke<PhasedProgramView>(vera, 'phased-program', { programId });
  const change = async (action: string, extra: object = {}) => { const v = await view(); return invoke(vera, 'control-phased-program', { programId, revision: v.revision, action, ...extra }); };
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stride-phases-')); host = new SqliteScopeHost({ dir, clock: clock.read });
    MODULES.forEach((m) => host.registerModule(m)); w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1); bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
    nina = await host.getScope(w.nina, w.t1, w.s1); ola = await host.getScope(w.ola, w.t1, w.s1);
    const workout = { name: 'Practice', items: [{ exerciseId: w.squatId, sets: [{ mode: 'amrap' as const, reps: 0, restSeconds: 90, load: '20' }] }] };
    plan = sequencePlan.parse({ name: 'A changing programme', description: 'Test', assessmentExerciseId: w.squatId,
      goal: { exerciseId: w.squatId, mode: 'single-set', target: 10 },
      tracks: [{ key: 'easy', name: 'Foundation', min: 0, max: 9, startPhase: 0 }, { key: 'hard', name: 'Building', min: 10, max: 1000, startPhase: 0 }],
      phases: [
        { name: 'Foundation', progression: 'milestone', milestone: { exerciseId: w.squatId, mode: 'single-set', target: 10 }, days: Object.fromEntries(['easy', 'hard'].map((key) => [key, [
          { name: 'Assessment', rest: false, workouts: [workout, { ...workout, name: 'Evening' }] }, { name: 'Rest', rest: true, workouts: [] },
        ]])) },
        { name: 'Build', progression: 'scheduled', days: Object.fromEntries(['easy', 'hard'].map((key) => [key, [{ name: 'Practice', rest: false, workouts: [{ ...workout, items: [{ ...workout.items[0], sets: [{ mode: 'fixed', reps: key === 'easy' ? 5 : 8, restSeconds: 60 }] }] }] }]])) },
      ],
    });
  });
  afterAll(async () => { await host.close(); rmSync(dir, { recursive: true, force: true }); });

  it('validates track ranges, required milestones, dates and explicit set modes', () => {
    const bad = structuredClone(plan); bad.tracks[1].min = 9;
    expect(sequencePlan.safeParse(bad).success).toBe(false);
    bad.tracks[1].min = 10; delete bad.phases[0].milestone;
    expect(sequencePlan.safeParse(bad).success).toBe(false);
    expect(dateInZone('2026-03-28T23:30:00Z', 'Europe/Madrid')).toBe('2026-03-29');
    expect(dateInZone('2026-03-29T22:30:00Z', 'Europe/Madrid')).toBe('2026-03-30');
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30');
  });
  it('saves and assigns a snapshot; others cannot edit or assign for Vera', async () => {
    const saved = await invoke<{ templateId: string }>(vera, 'save-phased-plan', { plan }); templateId = saved.templateId;
    await expect(invoke(bjorn, 'save-phased-plan', { templateId, revision: 1, plan })).rejects.toThrow(/permission denied/);
    await invoke(vera, 'share-template', { templateId, with: 'gym' });
    await expect(invoke(bjorn, 'assign-phased-plan', { templateId, traineeId: w.veraId, startDate: '2026-03-28', timezone: 'Europe/Madrid', trackKey: 'easy' })).rejects.toThrow(/result:log/);
    const result = await invoke<{ programId: string }>(vera, 'assign-phased-plan', { templateId, startDate: '2026-03-28', timezone: 'Europe/Madrid', trackKey: 'easy' }); programId = result.programId;
    const changed = structuredClone(plan); changed.name = 'New library name';
    await invoke(vera, 'save-phased-plan', { templateId, revision: 1, plan: changed });
    expect((await view()).plan.name).toBe(plan.name);
    await expect(invoke(vera, 'save-phased-plan', { templateId, revision: 1, plan })).rejects.toThrow(/Reload/);
    await expect(invoke(vera, 'add-template-item', { templateId, exerciseId: w.squatId, targetSets: 1, targetReps: 5 })).rejects.toThrow(/phased plan/);
  });
  it('starts one occurrence idempotently and keeps two daily workouts separate', async () => {
    const v = await view(); expect(v.days).toHaveLength(4);
    await expect(invoke(vera, 'begin-phased-session', { programId, occurrenceId: v.days[0].id })).rejects.toThrow(/Start the programme first/);
    await vera.invoke('workorder/start', { orderId: programId });
    const first = await invoke<{ sessionId: string; itemIds: string[] }>(vera, 'begin-phased-session', { programId, occurrenceId: v.days[0].id });
    expect(await invoke(vera, 'begin-phased-session', { programId, occurrenceId: v.days[0].id })).toEqual(first);
    const second = await invoke<{ sessionId: string; itemIds: string[] }>(vera, 'begin-phased-session', { programId, occurrenceId: v.days[1].id });
    expect(second.sessionId).not.toBe(first.sessionId);
    await expect(invoke(vera, 'log-set', { sessionId: first.sessionId, programItemId: second.itemIds[0], reps: 10 })).rejects.toThrow(/not prescribed/);
    await expect(invoke(vera, 'log-session', { programId })).rejects.toThrow(/phased programme/);
    await expect(invoke(vera, 'set-item-sets', { itemId: first.itemIds[0], sets: [{ reps: 999 }] })).rejects.toThrow(/phased programme/);
    await expect(invoke(vera, 'remove-program-item', { itemId: first.itemIds[0] })).rejects.toThrow(/phased programme/);
    const result = await invoke<{ set: SetResultRow }>(vera, 'log-set', { sessionId: first.sessionId, programItemId: first.itemIds[0], reps: 10, load: '20' }); loggedSet = result.set.id;
    const after = await view(); expect(after.goal).toMatchObject({ value: 10, achieved: true });
    expect(after.recommendation).toMatchObject({ trackKey: 'hard', reps: 10 });
    expect(after.days[0].prescription.workout!.items[0].sets[0]).toMatchObject({ mode: 'amrap', reps: 0, restSeconds: 90 });
    const progress = await invoke<ProgressView>(vera, 'progress', { traineeId: w.veraId });
    expect(progress.exercises.find((e) => e.exerciseId === w.squatId)?.series[0].points).toContainEqual(expect.objectContaining({ programId, sets: 1, bestReps: 10, volume: '200' }));
  });
  it('voided evidence stops counting; milestone advancement requires real visible results', async () => {
    await invoke(vera, 'void-set', { setId: loggedSet });
    expect((await view()).goal).toMatchObject({ value: 0, achieved: false });
    await expect(change('advance', { phaseIndex: 0 })).rejects.toThrow(/milestone has not been met/);
    const v = await view(); const d = v.days[0];
    await invoke(vera, 'log-set', { sessionId: d.sessionId, programItemId: d.itemIds[0], reps: 10 });
    await change('advance', { phaseIndex: 0 });
    await expect(change('advance', { phaseIndex: 0 })).rejects.toThrow(/already confirmed/);
    await change('change-track', { trackKey: 'hard', assessmentSetId: (await view()).recommendation!.setId });
    const next = await view(); expect(next.days.find((d) => d.phaseIndex === 1)!.prescription.workout!.items[0].sets[0].reps).toBe(8);
    expect(next.days[0].prescription.workout!.items[0].sets[0].mode).toBe('amrap');
    await change('finish-session', { occurrenceId: d.id });
    await expect(invoke(vera, 'log-set', { sessionId: d.sessionId, programItemId: d.itemIds[0], reps: 5 })).rejects.toThrow(/session is finished/);
  });
  it('edits an unstarted prescription without changing session history', async () => {
    const before = await view();
    const future = before.days.find((d) => d.phaseIndex === 1)!;
    const workout = structuredClone(future.prescription.workout!);
    workout.items[0].sets[0] = { mode: 'amrap', reps: 3, restSeconds: 120 };
    await change('edit-future', { occurrenceId: future.id, workout });
    const after = await view();
    expect(after.days.find((d) => d.id === future.id)!.prescription.workout!.items[0].sets[0]).toEqual(workout.items[0].sets[0]);
    expect(after.days[0].prescription).toEqual(before.days[0].prescription);
    await expect(change('edit-future', { occurrenceId: before.days[0].id, workout })).rejects.toThrow(/unstarted day/);
    await expect(invoke(vera, 'begin-phased-session', { programId, occurrenceId: future.id })).rejects.toThrow(/not scheduled today/);
  });
  it('pauses across daylight saving, shifts only future days, records skips and rejects duplicate edits', async () => {
    await change('pause'); clock.set('2026-03-30T10:00:00Z');
    const old = await view(); expect(old.today).toBe('2026-03-30');
    await expect(change('reschedule', { occurrenceId: old.days.find((d) => d.phaseIndex === 1)!.id, date: '2026-04-02' })).rejects.toThrow(/Resume this programme/);
    await expect(change('repeat-phase', { phaseIndex: 0, date: '2026-04-02' })).rejects.toThrow(/Resume this programme/);
    await change('resume'); const v = await view();
    expect(v.days.find((d) => d.phaseIndex === 1)!.date).toBe('2026-04-01');
    expect(v.days[0].date).toBe('2026-03-28');
    const future = v.days.find((d) => d.phaseIndex === 1)!;
    await change('reschedule', { occurrenceId: future.id, date: '2026-03-30' });
    await expect(invoke(vera, 'control-phased-program', { programId, revision: v.revision, action: 'reschedule', occurrenceId: future.id, date: '2026-03-30' })).rejects.toThrow(/Reload/);
    await change('skip', { occurrenceId: future.id });
    expect((await view()).days.find((d) => d.id === future.id)!.status).toBe('skipped');
    await expect(invoke(vera, 'begin-phased-session', { programId, occurrenceId: future.id })).rejects.toThrow(/not an available training day/);
    await change('repeat-day', { occurrenceId: future.id, date: '2026-03-31' });
    const repeated = (await view()).days.find((d) => d.phaseIndex === 1 && d.date === '2026-03-31')!;
    expect(repeated.id).not.toBe(future.id); expect(repeated.sessionId).toBeNull();
    await expect(change('repeat-day', { occurrenceId: future.id, date: '2026-03-31' })).rejects.toThrow(/already scheduled/);
    await change('repeat-phase', { phaseIndex: 0, date: '2026-04-03' });
    expect((await view()).days.filter((d) => d.date >= '2026-04-03')).toHaveLength(3);
  });
  it('does not leak goal totals or completed-session status after sharing is downgraded', async () => {
    await expect(invoke(bjorn, 'phased-program', { programId })).rejects.toThrow(/permission denied/);
    await expect(invoke(ola, 'control-phased-program', { programId, revision: 1, action: 'pause' })).rejects.toThrow(/permission denied/);
    await invoke(vera, 'set-sharing', { coachId: w.ninaId, mode: 'all' });
    expect((await invoke<PhasedProgramView>(nina, 'phased-program', { programId })).goal!.value).toBe(10);
    await invoke(vera, 'set-sharing', { coachId: w.ninaId, mode: 'from-now' });
    // Create a new visible session so the coach may read the programme, but not its older results.
    clock.set('2026-03-31T10:00:00Z'); const d = (await view()).days.find((d) => d.date === '2026-03-31' && d.status === 'pending')!;
    await invoke(vera, 'begin-phased-session', { programId, occurrenceId: d.id });
    const coach = await invoke<PhasedProgramView>(nina, 'phased-program', { programId });
    expect(coach.goal!.value).toBe(0); expect(coach.recommendation).toBeNull();
    await expect(invoke(nina, 'complete-program', { programId })).rejects.toThrow(/permission denied/);
    expect(coach.days[0]).toMatchObject({ sessionId: null, itemIds: [], status: 'scheduled' });
    // Resuming the older occurrence must not hand back the ids the view just masked.
    await expect(invoke(nina, 'begin-phased-session', { programId, occurrenceId: coach.days[0].id })).rejects.toThrow(/result:read/);
    const detail = await invoke<ProgramDetail>(nina, 'get-program', { programId });
    expect(detail.sessions).toHaveLength(1); expect(detail.items).toHaveLength(1);
    const cards = await invoke<{ id: string; setsLogged: number }[]>(nina, 'my-programs');
    expect(cards.find((p) => p.id === programId)!.setsLogged).toBe(0);
    await invoke(vera, 'set-sharing', { coachId: w.ninaId, mode: 'none' });
    await expect(invoke(nina, 'phased-program', { programId })).rejects.toThrow(/permission denied/);
    const otherGym = await host.getScope(w.rutger, w.t2, w.s2);
    await expect(invoke(otherGym, 'phased-program', { programId })).rejects.toThrow(/not found|permission denied/);
  });
  it('publishes nested schemas and exposes schedule and goal reads over MCP', async () => {
    const app = new Hono(); mountOperations(app, operations, async () => vera, { basePath: '/api', knownOperations });
    const rpc = async (method: string, params: object = {}) => {
      const response = await app.request('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return await response.json() as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[]; isError?: boolean; structuredContent: PhasedProgramView; content: { text: string }[] } };
    };
    const list = await rpc('tools/list');
    expect(list.result.tools.find((t) => t.name === mcpToolName('stride/save-phased-plan'))!.inputSchema.properties.plan).toHaveProperty('properties.phases');
    const read = await rpc('tools/call', { name: mcpToolName('stride/phased-program'), arguments: { programId } });
    expect(read.result.isError).not.toBe(true); expect(read.result.structuredContent.goal!.value).toBe(10);
    const bad = await rpc('tools/call', { name: mcpToolName('stride/assign-phased-plan'), arguments: {} });
    expect(bad.result.isError).toBe(true); expect(bad.result.content[0].text).toContain('startDate');
  });
  it('uses every scheduled occurrence for adherence and never finishes on a deadline', async () => {
    clock.set('2026-06-01T10:00:00Z');
    const detail = await invoke<ProgramDetail>(vera, 'get-program', { programId }); expect(detail.program.status).toBe('in_progress');
    const v = await view(); const expected = v.days.reduce((n, d) => n + (d.prescription.workout?.items.reduce((sum, i) => sum + i.sets.length, 0) ?? 0), 0);
    const done = await invoke<{ summary: ProgramSummaryRow }>(vera, 'complete-program', { programId });
    expect(done.summary.prescribed_sets).toBe(expected); expect(done.summary.performed_sets).toBe(1);
    await expect(change('pause')).rejects.toThrow(/finished programme/);
  });
  it('leaves a library plan the gym turned phased alone when the starter library is re-installed', async () => {
    const astrid = await host.getScope(w.astrid, w.t1, w.s1);
    const name = 'Running — base week';
    const lib = (await invoke<{ id: string; name: string; items: { id: string }[] }[]>(astrid, 'templates')).find((t) => t.name === name)!;
    for (const item of lib.items) await invoke(astrid, 'remove-template-item', { itemId: item.id });
    await invoke(astrid, 'save-phased-plan', { templateId: lib.id, plan: { ...plan, name } });
    const report = await invoke<{ templates: number; templateItems: number }>(astrid, 'install-starter-library');
    expect(report).toMatchObject({ templates: 0, templateItems: 0 });
    expect((await invoke<{ id: string; items: unknown[] }[]>(astrid, 'templates')).find((t) => t.id === lib.id)!.items).toHaveLength(0);
  });
});
