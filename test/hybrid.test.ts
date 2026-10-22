import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteScopeHost } from '@substrat-run/adapter-sqlite';
import { manualClock, type ScopeStub } from '@substrat-run/kernel';
import type { WorkOrder } from '@substrat-run/engine-workorder';
import { MODULES, seedStride, type StrideWorld } from '../src/seed.js';
import type {
  ExerciseView,
  HrZones,
  ItemRow,
  ProgramDetail,
  SetResultRow,
  WearableRecorded,
  WearableView,
} from '../src/module.js';

// ============================================================================
// HYBRID TRAINING — cardio prescribed by time and zone, intervals, AMRAP in an ordinary
// workout, effort on a set, the zones behind a wearable's four, and a run that lands in the
// feed attaching itself to the plan.
// ============================================================================

describe('hybrid strength + cardio', () => {
  // Wednesday 2026-10-14, noon UTC.
  const clock = manualClock('2026-10-14T12:00:00.000Z');
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let vera: ScopeStub;
  let bjorn: ScopeStub;
  let nina: ScopeStub;
  let runId: string;
  let pullId: string;
  let programId: string;
  let sessionId: string;
  let items: Record<string, ItemRow> = {};

  const inv = <T = unknown>(who: ScopeStub, op: string, input?: unknown) => who.invoke<T>(`stride/${op}`, input as never);
  const activity = (over: Record<string, unknown> = {}) => ({
    externalId: 'run-1',
    kind: 'run',
    startedAt: '2026-10-14T06:00:00.000Z',
    endedAt: '2026-10-14T06:45:00.000Z',
    durationSeconds: 2700,
    distanceM: '8200.4',
    hrAvg: 148,
    hrMax: 176,
    hrZone0Seconds: 300,
    hrZone1Seconds: 1200,
    hrZone2Seconds: 1000,
    hrZone3Seconds: 200,
    ...over,
  });
  const record = (who: ScopeStub, activities: unknown[], traineeId = w.veraId) =>
    inv<WearableRecorded>(who, 'record-wearable', { traineeId, source: 'withings', activities });
  const detail = () => inv<ProgramDetail>(vera, 'get-program', { programId });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stride-hybrid-'));
    host = new SqliteScopeHost({ dir, clock: clock.read });
    MODULES.forEach((m) => host.registerModule(m));
    w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1);
    bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
    nina = await host.getScope(w.nina, w.t1, w.s1);
    const exercises = await inv<ExerciseView[]>(vera, 'exercises');
    runId = exercises.find((e) => e.slug === 'run-outdoor')!.id;
    pullId = (await inv<{ id: string }>(vera, 'author-exercise', {
      slug: 'pull-up-test', name: 'Pull-up', modality: 'strength', unit: 'reps', description: 'Pull-up.',
    })).id;

    const made = await inv<{ program: WorkOrder }>(vera, 'assign-program', {
      title: 'Hybrid week', kind: 'conditioning', slots: [{ weekday: 3, time: '06:00' }],
    });
    programId = made.program.id;
    const add = (body: Record<string, unknown>) => inv<ItemRow>(vera, 'add-program-item', { programId, ...body });
    items.easy = await add({ exerciseId: runId, targetSets: 1, targetSeconds: 2700, targetZone: 2, recurDays: '3' });
    items.range = await add({ exerciseId: runId, targetSets: 1, targetSeconds: 1800, targetHrMin: 130, targetHrMax: 145, recurDays: '6' });
    items.intervals = await add({ exerciseId: runId, targetSets: 6, workSeconds: 120, restSeconds: 120 });
    items.test = await add({ exerciseId: pullId, targetSets: 1, amrap: true });
    await vera.invoke('workorder/start', { orderId: programId });
    sessionId = (await inv<{ session: { id: string } }>(vera, 'begin', { programId })).session.id;
  });
  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores optional notes on ordinary results, including null for an omitted note', async () => {
    const noted = await inv<{ set: SetResultRow }>(vera, 'log-set', { sessionId, programItemId: items.test.id, reps: 1, note: 'negative push-up' });
    expect(noted.set.note).toBe('negative push-up');
    expect((await detail()).sessions.find((s) => s.id === sessionId)!.sets.find((s) => s.id === noted.set.id)!.note).toBe('negative push-up');
    const plain = await inv<{ set: SetResultRow }>(vera, 'log-set', { sessionId, programItemId: items.test.id, reps: 1 });
    expect(plain.set.note).toBeNull();
    await inv(vera, 'void-set', { setId: noted.set.id });
    await inv(vera, 'void-set', { setId: plain.set.id });
  });

  it('a cardio row can be prescribed by time and zone, or by a bpm range, instead of a distance', () => {
    expect(items.easy).toMatchObject({ target_seconds: 2700, target_zone: 2, target_reps: 0, target_hr_min: null });
    expect(items.range).toMatchObject({ target_seconds: 1800, target_zone: null, target_hr_min: 130, target_hr_max: 145 });
  });

  it('refuses a prescription that contradicts itself', async () => {
    const add = (body: Record<string, unknown>) => inv(vera, 'add-program-item', { programId, exerciseId: runId, targetSets: 1, ...body });
    await expect(add({ targetSeconds: 600, targetZone: 2, targetHrMin: 120, targetHrMax: 140 })).rejects.toThrow(/never both/);
    await expect(add({ targetSeconds: 600, targetHrMin: 120 })).rejects.toThrow(/both targetHrMin and targetHrMax/);
    await expect(add({ targetSeconds: 600, targetHrMin: 150, targetHrMax: 140 })).rejects.toThrow(/below/);
    await expect(add({ targetSeconds: 600, restSeconds: 30 })).rejects.toThrow(/interval/);
    await expect(add({ workSeconds: 60, amrap: true })).rejects.toThrow(/not both/);
    await expect(add({})).rejects.toThrow(/targetReps is required/);
  });

  it('an interval block is ONE item: rounds are its sets, work and rest are its shape', () => {
    expect(items.intervals).toMatchObject({ target_sets: 6, work_seconds: 120, rest_seconds: 120, target_zone: null });
  });

  it('an AMRAP test sits in an ordinary workout and takes whatever number was reached', async () => {
    expect(items.test).toMatchObject({ amrap: 1, target_reps: 0, target_sets: 1 });
    const { set } = await inv<{ set: SetResultRow }>(vera, 'log-set', { sessionId, programItemId: items.test.id, reps: 14 });
    expect(set.reps).toBe(14); // not capped, not compared with a target
  });

  it('a set carries RPE or reps in reserve, validated, never both', async () => {
    const log = (extra: Record<string, unknown>) => inv<{ set: SetResultRow }>(vera, 'log-set', { sessionId, programItemId: items.test.id, reps: 8, ...extra });
    expect((await log({ rir: 2 })).set).toMatchObject({ rir: 2, rpe: null });
    expect((await log({ rpe: '8.5' })).set).toMatchObject({ rpe: '8.5', rir: null });
    await expect(log({ rpe: '8', rir: 2 })).rejects.toThrow(/not both/);
    await expect(log({ rpe: '11' })).rejects.toThrow(/RPE is 1 to 10/);
    await expect(log({ rir: -1 })).rejects.toThrow();
  });

  it('shows the bpm behind each zone, from the maximum the person sets', async () => {
    const before = await inv<HrZones>(vera, 'hr-zones', { traineeId: w.veraId });
    expect(before).toMatchObject({ maxHr: null, source: null, zones: null });

    const set = await inv<HrZones>(vera, 'set-max-hr', { traineeId: w.veraId, maxHr: 190 });
    expect(set).toMatchObject({ maxHr: 190, source: 'set' });
    expect(set.zones).toEqual([
      { zone: 0, name: 'Light', minBpm: null, maxBpm: 113 },
      { zone: 1, name: 'Moderate', minBpm: 114, maxBpm: 132 },
      { zone: 2, name: 'Intense', minBpm: 133, maxBpm: 161 },
      { zone: 3, name: 'Maximal', minBpm: 162, maxBpm: 190 },
    ]);
    // …and the programme carries them, so a prescribed "zone 2" reads as bpm.
    expect((await detail()).hrZones?.zones?.[2]).toMatchObject({ minBpm: 133, maxBpm: 161 });
  });

  it('a maximum heart rate is a fact about a body: nobody else may read or set it', async () => {
    await expect(inv(bjorn, 'hr-zones', { traineeId: w.veraId })).rejects.toThrow(/permission denied/);
    await expect(inv(bjorn, 'set-max-hr', { traineeId: w.veraId, maxHr: 150 })).rejects.toThrow(/permission denied/);
    // Her coach, until she shares, reads the prescription but not her heart.
    await expect(inv(nina, 'hr-zones', { traineeId: w.veraId })).rejects.toThrow(/permission denied/);
    await expect(inv(vera, 'set-max-hr', { traineeId: w.veraId, maxHr: 90 })).rejects.toThrow();
  });

  describe('a wearable workout attaches itself to the plan', () => {
    it('lands on the planned run for that Wednesday and marks it done with everything the device said', async () => {
      const r = await record(vera, [activity()]);
      expect(r.matched).toHaveLength(1);
      expect(r.matched[0]).toMatchObject({ programId, itemId: items.easy.id, externalId: 'run-1' });

      const d = await detail();
      const sets = d.sessions.flatMap((s) => s.sets).filter((s) => s.program_item_id === items.easy.id);
      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({
        reps: 8200, // metres, rounded
        duration_seconds: 2700,
        avg_hr: 148,
        max_hr: 176,
        hr_zone0_seconds: 300,
        hr_zone1_seconds: 1200,
        hr_zone2_seconds: 1000,
        hr_zone3_seconds: 200,
        side: null,
      });
      expect(sets[0]!.activity_id).toBeTruthy();
    });

    it('a re-sync never logs the same run twice, and a revision does not either', async () => {
      expect((await record(vera, [activity()])).matched).toEqual([]);
      expect((await record(vera, [activity({ distanceM: '8300' })])).matched).toEqual([]);
      const d = await detail();
      expect(d.sessions.flatMap((s) => s.sets).filter((s) => s.program_item_id === items.easy.id)).toHaveLength(1);
    });

    it('does not match a workout that is not due, of the wrong kind, or already done by hand', async () => {
      // Thursday: nothing is prescribed on a Thursday.
      expect((await record(vera, [activity({ externalId: 'thu', startedAt: '2026-10-15T06:00:00.000Z', endedAt: '2026-10-15T06:40:00.000Z' })])).matched).toEqual([]);
      // Wednesday, but a swim.
      expect((await record(vera, [activity({ externalId: 'swim', kind: 'swim' })])).matched).toEqual([]);
      // A second run the same Wednesday: the item is already done today.
      expect((await record(vera, [activity({ externalId: 'run-2', startedAt: '2026-10-14T17:00:00.000Z', endedAt: '2026-10-14T17:30:00.000Z', durationSeconds: 1800 })])).matched).toEqual([]);
    });

    it('does not rewrite history: an old workout is left alone', async () => {
      expect((await record(vera, [activity({ externalId: 'old', startedAt: '2026-09-02T06:00:00.000Z', endedAt: '2026-09-02T06:45:00.000Z' })])).matched).toEqual([]);
    });

    it('taking the set back is a void, and the run stays unmatched for ever', async () => {
      const set = (await detail()).sessions.flatMap((s) => s.sets).find((s) => s.activity_id)!;
      await inv(vera, 'void-set', { setId: set.id });
      expect((await detail()).sessions.flatMap((s) => s.sets).filter((s) => s.activity_id)).toHaveLength(0);
      expect((await record(vera, [activity({ distanceM: '8400' })])).matched).toEqual([]);
    });

    it('is not a way to write into someone else’s training', async () => {
      await expect(record(bjorn, [activity({ externalId: 'x' })], w.veraId)).rejects.toThrow(/permission denied/);
    });
  });

  describe('a lighter wearable read', () => {
    beforeAll(async () => {
      await record(vera, [
        activity({ externalId: 'a-ride', kind: 'cycle', startedAt: '2026-10-05T08:00:00.000Z', endedAt: '2026-10-05T09:00:00.000Z', durationSeconds: 3600, distanceM: '25000.5', hrZone2Seconds: 600 }),
        activity({ externalId: 'a-run2', kind: 'run', startedAt: '2026-10-07T08:00:00.000Z', endedAt: '2026-10-07T08:30:00.000Z', durationSeconds: 1800, distanceM: '5000.25', hrZone2Seconds: 900 }),
        activity({ externalId: 'a-run3', kind: 'run', startedAt: '2026-09-28T08:00:00.000Z', endedAt: '2026-09-28T08:30:00.000Z', durationSeconds: 1200, distanceM: '3000' }),
      ]);
      await inv(vera, 'record-wearable', {
        traineeId: w.veraId, source: 'withings',
        sleep: [{ externalId: 'n1', night: '2026-10-06', startedAt: '2026-10-05T22:00:00.000Z', endedAt: '2026-10-06T06:00:00.000Z', asleepSeconds: 25_200, score: 80 },
                { externalId: 'n2', night: '2026-10-07', startedAt: '2026-10-06T22:00:00.000Z', endedAt: '2026-10-07T06:00:00.000Z', asleepSeconds: 27_000, score: 90 }],
        days: [{ day: '2026-10-06', steps: 8000 }, { day: '2026-10-07', steps: 10_000 }],
      });
    });
    const read = (extra: Record<string, unknown>) => inv<WearableView>(vera, 'wearable', { traineeId: w.veraId, ...extra });

    it('filters by kind, and a kind filter means activities unless asked otherwise', async () => {
      const runs = await read({ kind: 'run' });
      expect(runs.activities.every((a) => a.kind === 'run')).toBe(true);
      expect(runs.activities.length).toBeGreaterThanOrEqual(3);
      expect(runs.sleep).toEqual([]);
      const both = await read({ kind: 'run,cycle', days: 30 });
      expect(new Set(both.activities.map((a) => a.kind))).toEqual(new Set(['run', 'cycle']));
      await expect(read({ kind: 'run,teleport' })).rejects.toThrow(/kinds are/);
    });

    it('filters by date range, inclusive both ends', async () => {
      const r = await read({ from: '2026-10-05', to: '2026-10-07', include: ['activities'] });
      expect(r.activities.map((a) => a.external_id).sort()).toEqual(['a-ride', 'a-run2']);
      await expect(read({ from: '2026-10-08', to: '2026-10-07' })).rejects.toThrow(/after/);
    });

    it('summarises as weekly totals that equal the rows', async () => {
      const rows = await read({ from: '2026-09-28', to: '2026-10-11', include: ['activities'] });
      const s = await read({ from: '2026-09-28', to: '2026-10-11', summary: true });
      expect(s.activities).toEqual([]);
      expect(s.weeks!.map((x) => x.week)).toEqual(['2026-10-05', '2026-09-28']); // newest first, Mondays
      const wk = s.weeks!.find((x) => x.week === '2026-10-05')!;
      expect(wk).toMatchObject({
        workouts: 2,
        durationSeconds: 5400,
        distanceM: '30000.75',
        zoneSeconds: [600, 2400, 1500, 400],
        nights: 2,
        avgAsleepSeconds: 26_100,
        avgSleepScore: 85,
        daysWithSteps: 2,
        steps: 18_000,
        avgSteps: 9000,
      });
      expect(wk.byKind).toEqual([
        { kind: 'cycle', workouts: 1, durationSeconds: 3600, distanceM: '25000.5' },
        { kind: 'run', workouts: 1, durationSeconds: 1800, distanceM: '5000.25' },
      ]);
      // …and they agree with the rows they summarise.
      const inWeek = rows.activities.filter((a) => a.started_at >= '2026-10-05');
      expect(wk.workouts).toBe(inWeek.length);
      expect(wk.durationSeconds).toBe(inWeek.reduce((n, a) => n + a.duration_seconds, 0));
    });

    it('is a fraction of the size', async () => {
      const rows = JSON.stringify(await read({ days: 120 }));
      const sum = JSON.stringify(await read({ days: 120, summary: true }));
      expect(sum.length).toBeLessThan(rows.length);
    });

    it('is as private as the rows: a stranger reads neither', async () => {
      await expect(inv(bjorn, 'wearable', { traineeId: w.veraId, summary: true })).rejects.toThrow(/permission denied/);
    });
  });
});
