import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ScopeStub } from '@substrat-run/kernel';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';

import type { WearableRecorded, WearableView } from '../src/module.js';
import { buildStrideHost, seedStride, type StrideWorld } from '../src/seed.js';

// ============================================================================
// WEARABLES — what a device recorded, mirrored and rewritten on sync.
//
// The module knows nothing about HOW it arrives; these tests hold the three things
// it does own: a sync is an upsert that says what it did, every change leaves a fat
// event and a no-op leaves none, and the keys are the measurement keys — so a coach
// sees none of it until the person shares everything.
// ============================================================================

const run = (over: Record<string, unknown> = {}) => ({
  externalId: 'w-1',
  kind: 'run',
  startedAt: '2026-10-09T06:00:00.000Z',
  endedAt: '2026-10-09T06:45:00.000Z',
  durationSeconds: 2700,
  distanceM: '8200',
  calories: '520',
  hrAvg: 148,
  hrMin: 96,
  hrMax: 176,
  hrZone0Seconds: 300,
  hrZone1Seconds: 1200,
  hrZone2Seconds: 1000,
  hrZone3Seconds: 200,
  ...over,
});
const night = (over: Record<string, unknown> = {}) => ({
  externalId: 's-1',
  night: '2026-10-10',
  startedAt: '2026-10-09T22:10:00.000Z',
  endedAt: '2026-10-10T05:50:00.000Z',
  inBedSeconds: 27_600,
  asleepSeconds: 25_200,
  deepSeconds: 5400,
  remSeconds: 6300,
  lightSeconds: 13_500,
  score: 82,
  efficiency: '0.91',
  hrAvg: 54,
  ...over,
});
const day = (over: Record<string, unknown> = {}) => ({ day: '2026-10-10', steps: 9120, distanceM: '6900', activeSeconds: 3100, ...over });

describe('wearables', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let vera: ScopeStub;
  let bjorn: ScopeStub;
  let nina: ScopeStub; // Vera's coach
  let astrid: ScopeStub; // admin

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-wearable-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1);
    bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
    nina = await host.getScope(w.nina, w.t1, w.s1);
    astrid = await host.getScope(w.astrid, w.t1, w.s1);
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const record = (s: ScopeStub, body: Record<string, unknown>, traineeId = w.veraId) =>
    s.invoke<WearableRecorded>('stride/record-wearable', { traineeId, source: 'withings', ...body });
  const read = (s: ScopeStub, traineeId = w.veraId, days?: number) =>
    s.invoke<WearableView>('stride/wearable', { traineeId, ...(days ? { days } : {}) });
  const announced = async () =>
    (await vera.invoke<{ type: string; actor: string }[]>('stride/timeline', {
      entityType: 'trainee',
      entityId: w.veraId,
    })).filter((e) => /^stride\.(activity|sleep|activity-day)-recorded$/.test(e.type));

  it('records a workout, a night and a day, newest first, with the zones exactly as sent', async () => {
    const r = await record(vera, {
      activities: [run(), run({ externalId: 'w-0', kind: 'walk', startedAt: '2026-10-08T17:00:00.000Z', endedAt: '2026-10-08T17:30:00.000Z', durationSeconds: 1800 })],
      sleep: [night()],
      days: [day(), day({ day: '2026-10-09', steps: 4000 })],
    });
    expect(r).toEqual({
      activities: { created: 2, updated: 0, unchanged: 0 },
      sleep: { created: 1, updated: 0, unchanged: 0 },
      days: { created: 2, updated: 0, unchanged: 0 },
    });

    const mine = await read(vera, w.veraId, 730);
    expect(mine.activities.map((a) => [a.external_id, a.kind])).toEqual([['w-1', 'run'], ['w-0', 'walk']]);
    expect(mine.activities[0]).toMatchObject({
      distance_m: '8200',
      calories: '520',
      hr_avg: 148,
      hr_max: 176,
      hr_zone2_seconds: 1000,
      source: 'withings',
      recorded_by: w.vera,
    });
    expect(mine.sleep[0]).toMatchObject({ night: '2026-10-10', score: 82, efficiency: '0.91', deep_seconds: 5400 });
    expect(mine.days.map((d) => [d.day, d.steps])).toEqual([['2026-10-10', 9120], ['2026-10-09', 4000]]);
  });

  it('the same reading again is unchanged and silent; a revised one is updated and announced', async () => {
    const before = (await announced()).length;

    const again = await record(vera, { activities: [run()], sleep: [night()], days: [day()] });
    expect(again).toEqual({
      activities: { created: 0, updated: 0, unchanged: 1 },
      sleep: { created: 0, updated: 0, unchanged: 1 },
      days: { created: 0, updated: 0, unchanged: 1 },
    });
    expect((await announced()).length).toBe(before); // a sync that found nothing new emits nothing

    // Withings revises the night and the day's steps grow until midnight.
    const revised = await record(vera, { sleep: [night({ score: 85 })], days: [day({ steps: 11_480 })] });
    expect(revised.sleep.updated).toBe(1);
    expect(revised.days.updated).toBe(1);
    const after = await read(vera, w.veraId, 730);
    expect(after.sleep.filter((n) => n.external_id === 's-1')).toHaveLength(1); // revised, never doubled
    expect(after.sleep[0]!.score).toBe(85);
    expect(after.days.find((d) => d.day === '2026-10-10')!.steps).toBe(11_480);

    // …and each change is on the spine, by whom, so what was believed when is not lost.
    const spine = await announced();
    expect(spine.length).toBe(before + 2);
    expect(spine.slice(-2).map((e) => e.type)).toEqual(['stride.sleep-recorded', 'stride.activity-day-recorded']);
    expect(spine.slice(-2).every((e) => e.actor.includes(w.vera))).toBe(true);
  });

  it('reads only as far back as asked', async () => {
    await record(vera, { activities: [run({ externalId: 'old', startedAt: '2020-01-01T06:00:00.000Z', endedAt: '2020-01-01T06:30:00.000Z', durationSeconds: 1800 })] });
    expect((await read(vera, w.veraId, 90)).activities.some((a) => a.external_id === 'old')).toBe(false);
  });

  it('refuses what is not a reading: a float, a negative, an end before the start, an unknown kind or source', async () => {
    await expect(record(vera, { activities: [run({ distanceM: 8200.5 })] })).rejects.toThrow();
    await expect(record(vera, { activities: [run({ distanceM: '-5' })] })).rejects.toThrow(/negative/);
    await expect(record(vera, { activities: [run({ durationSeconds: -1 })] })).rejects.toThrow();
    await expect(record(vera, { activities: [run({ hrAvg: 4 })] })).rejects.toThrow(); // not a pulse
    await expect(record(vera, { activities: [run({ kind: 'teleport' })] })).rejects.toThrow();
    await expect(
      record(vera, { activities: [run({ startedAt: '2026-10-09T07:00:00.000Z', endedAt: '2026-10-09T06:00:00.000Z' })] }),
    ).rejects.toThrow(/cannot end before/);
    await expect(record(vera, { sleep: [night({ night: 'last tuesday' })] })).rejects.toThrow();
    await expect(
      vera.invoke('stride/record-wearable', { traineeId: w.veraId, source: 'fitbit', days: [day()] }),
    ).rejects.toThrow();
  });

  it('is the person\'s own: another trainee neither writes nor reads it, and the denial names the key', async () => {
    await expect(record(bjorn, { days: [day({ day: '2026-10-01' })] })).rejects.toThrow(/permission denied: result:log/);
    await expect(read(bjorn)).rejects.toThrow(/permission denied: result:read/);
  });

  it('a coach sees none of it until the person shares everything, and loses it again when they take it back', async () => {
    // On the 'assigned' floor she holds the coaching grant — she can record in the room, and cannot read it back.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
    await record(nina, { days: [day({ day: '2026-10-02', steps: 100 })] });
    await expect(read(nina)).rejects.toThrow(/permission denied: result:read/);

    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'all' });
    expect((await read(nina)).sleep.length).toBeGreaterThan(0);

    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
    await expect(read(nina)).rejects.toThrow(/permission denied: result:read/);

    // The admin runs the gym and reads everyone's.
    expect((await read(astrid)).activities.length).toBeGreaterThan(0);
  });
});
