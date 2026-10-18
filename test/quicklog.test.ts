import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteScopeHost } from '@substrat-run/adapter-sqlite';
import { manualClock, type ScopeStub } from '@substrat-run/kernel';
import { MODULES, seedStride, type StrideWorld } from '../src/seed.js';
import type { QuickLogRow, QuickRecent } from '../src/module.js';

// ============================================================================
// QUICK LOG — a diary line for food or an activity with a count, and a list to repeat
// from. Same keys as a measurement: no new permission.
// ============================================================================

describe('quick log', () => {
  const clock = manualClock('2026-10-14T08:00:00.000Z');
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let vera: ScopeStub;
  let bjorn: ScopeStub;
  let nina: ScopeStub;

  const inv = <T = unknown>(who: ScopeStub, op: string, input?: unknown) => who.invoke<T>(`stride/${op}`, input as never);
  const log = (who: ScopeStub, body: Record<string, unknown>, traineeId = w.veraId) =>
    inv<QuickLogRow>(who, 'log-quick', { traineeId, ...body });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'stride-quick-'));
    host = new SqliteScopeHost({ dir, clock: clock.read });
    MODULES.forEach((m) => host.registerModule(m));
    w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1);
    bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
    nina = await host.getScope(w.nina, w.t1, w.s1);
  });
  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('logs food by name and an activity with a count, and refuses the mismatches', async () => {
    const food = await log(vera, { kind: 'food', label: '  Yoghurt   with muesli ' });
    expect(food).toMatchObject({ kind: 'food', label: 'Yoghurt with muesli', quantity: null, logged_at: '2026-10-14T08:00:00.000Z' });
    const pull = await log(vera, { kind: 'activity', label: 'Pull-up', quantity: 5 });
    expect(pull).toMatchObject({ kind: 'activity', label: 'Pull-up', quantity: 5 });

    await expect(log(vera, { kind: 'activity', label: 'Pull-up' })).rejects.toThrow(/number of times/);
    await expect(log(vera, { kind: 'food', label: 'Apple', quantity: 2 })).rejects.toThrow(/no number of times/);
    await expect(log(vera, { kind: 'food', label: '   ' })).rejects.toThrow();
    await expect(log(vera, { kind: 'activity', label: 'Pull-up', quantity: 0 })).rejects.toThrow();
    await expect(log(vera, { kind: 'activity', label: 'Pull-up', quantity: 2.5 })).rejects.toThrow();
    await expect(log(vera, { kind: 'food', label: 'Apple', loggedAt: 'yesterday-ish' })).rejects.toThrow(/not a date/);
    await expect(log(vera, { kind: 'food', label: 'Apple', loggedAt: '2099-01-01T00:00:00Z' })).rejects.toThrow(/future/);
  });

  it('offers earlier items to repeat: distinct, newest first, with the count last time', async () => {
    clock.advance(60_000);
    await log(vera, { kind: 'activity', label: 'Push-up', quantity: 20 });
    clock.advance(60_000);
    await log(vera, { kind: 'activity', label: 'pull-up', quantity: 8 }); // same entry, different case
    const recents = await inv<QuickRecent[]>(vera, 'quick-recents', { traineeId: w.veraId, kind: 'activity' });
    expect(recents.map((r) => [r.label, r.quantity, r.times])).toEqual([
      ['pull-up', 8, 2],
      ['Push-up', 20, 1],
    ]);
    const food = await inv<QuickRecent[]>(vera, 'quick-recents', { traineeId: w.veraId, kind: 'food' });
    expect(food.map((r) => r.label)).toEqual(['Yoghurt with muesli']);
  });

  it('lists lines newest first, filtered by kind and by since', async () => {
    const all = await inv<QuickLogRow[]>(vera, 'quick-logs', { traineeId: w.veraId });
    expect(all[0]!.label).toBe('pull-up');
    const foods = await inv<QuickLogRow[]>(vera, 'quick-logs', { traineeId: w.veraId, kind: 'food' });
    expect(foods.every((r) => r.kind === 'food')).toBe(true);
    const recent = await inv<QuickLogRow[]>(vera, 'quick-logs', {
      traineeId: w.veraId,
      since: '2026-10-14T08:01:30.000Z',
    });
    expect(recent.map((r) => r.label)).toEqual(['pull-up']);
  });

  it('takes a line back without deleting it, and the repeat list forgets it too', async () => {
    const oops = await log(vera, { kind: 'food', label: 'Cake' });
    expect((await inv<QuickRecent[]>(vera, 'quick-recents', { traineeId: w.veraId, kind: 'food' }))[0]!.label).toBe('Cake');
    expect(await inv(vera, 'void-quick-log', { logId: oops.id })).toEqual({ voided: oops.id, alreadyVoided: false });
    expect(await inv(vera, 'void-quick-log', { logId: oops.id })).toEqual({ voided: oops.id, alreadyVoided: true });
    const food = await inv<QuickRecent[]>(vera, 'quick-recents', { traineeId: w.veraId, kind: 'food' });
    expect(food.map((r) => r.label)).not.toContain('Cake');
    const lines = await inv<QuickLogRow[]>(vera, 'quick-logs', { traineeId: w.veraId });
    expect(lines.map((r) => r.id)).not.toContain(oops.id);
    // An unknown id and somebody else's id are refused the same way; only an admin, who may touch
    // any line, is told it does not exist.
    await expect(inv(vera, 'void-quick-log', { logId: 'nope' })).rejects.toThrow(/permission denied: result:log/);
    await expect(inv(await host.getScope(w.astrid, w.t1, w.s1), 'void-quick-log', { logId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('is nobody else’s: the denial names the key, and a log id alone reaches no one', async () => {
    await expect(log(bjorn, { kind: 'food', label: 'Apple' })).rejects.toThrow(/permission denied: result:log/);
    await expect(inv(bjorn, 'quick-logs', { traineeId: w.veraId })).rejects.toThrow(/permission denied: result:read/);
    await expect(inv(bjorn, 'quick-recents', { traineeId: w.veraId, kind: 'food' })).rejects.toThrow(
      /permission denied: result:read/,
    );
    const mine = await log(vera, { kind: 'food', label: 'Porridge' });
    await expect(inv(bjorn, 'void-quick-log', { logId: mine.id })).rejects.toThrow(/permission denied: result:log/);
    // Her coach holds the coaching floor, so may write a line in the room — but, as with
    // measurements, reading the diary back is Vera's decision (sharing: all).
    await expect(nina.invoke('stride/quick-logs', { traineeId: w.veraId })).rejects.toThrow(
      /permission denied: result:read/,
    );
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'all' });
    const seen = await inv<QuickLogRow[]>(nina, 'quick-logs', { traineeId: w.veraId });
    expect(seen.map((r) => r.label)).toContain('Porridge');
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
  });

  it('stores when it happened as canonical UTC, so text order is time order', async () => {
    const odd = await log(vera, { kind: 'food', label: 'Late snack', loggedAt: '2026-10-14T09:30:00+02:00' });
    expect(odd.logged_at).toBe('2026-10-14T07:30:00.000Z');
    const dateOnly = await log(vera, { kind: 'food', label: 'Date only', loggedAt: '2026-10-13' });
    expect(dateOnly.logged_at).toBe('2026-10-13T00:00:00.000Z');
  });
});
