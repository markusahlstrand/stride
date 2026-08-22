import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addDecimal, mulDecimal } from '@substrat-run/contracts';
import { ulid, type ScopeStub } from '@substrat-run/kernel';
import { principalId } from '@substrat-run/contracts';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';
import type { WorkOrder } from '@substrat-run/engine-workorder';
import type {
  AgendaEntry,
  EquipmentView,
  SharingView,
  ExerciseRow,
  ExerciseView,
  ScheduledItem,
  ItemRow,
  ProgramCard,
  ProgramDetail,
  ItemSetRow,
  MessageRow,
  ThreadView,
  ProgramSummaryRow,
  SessionRow,
  TemplateRow,
  TraineeRow,
  WhoAmI,
} from '../src/module.js';
import {
  buildStrideHost,
  drainPlatformRequests,
  seedStride,
  type StrideWorld,
} from '../src/seed.js';

// ============================================================================
// The training scenario, replayed headlessly against a temp dir.
//
// The happy path is the smaller half. The point of this file is the DENIALS —
// every one pinned to its message and paired with a control proving a
// neighbouring door is still open, so a green run can never be a silently
// broken one.
//
// The load-bearing tests are 4 (the guard), 6 (yours forever) and 8 (retire is
// not erase). If you change the permission model, those three are what tell you
// whether you changed it correctly.
// ============================================================================

const slugs = (rows: { slug: string }[]) => rows.map((r) => r.slug).sort();
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

describe('training scenario', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let astrid: ScopeStub; // admin
  let nina: ScopeStub; // coach — Vera's
  let ola: ScopeStub; // coach — Björn's
  let vera: ScopeStub; // trainee
  let bjorn: ScopeStub; // trainee
  let aclTemplateId: string;
  let veraProgramId: string;
  let bjornProgramId: string;
  let bjornSessionId: string;
  let nordicItemId: string;
  let plankItemId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-training-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    astrid = await host.getScope(w.astrid, w.t1, w.s1);
    nina = await host.getScope(w.nina, w.t1, w.s1);
    ola = await host.getScope(w.ola, w.t1, w.s1);
    vera = await host.getScope(w.vera, w.t1, w.s1);
    bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('1. provisions and applies every module journal', () => {
    const db = new Database(join(dir, `${w.t1}__${w.s1}.sqlite`), { readonly: true });
    const rows = db
      .prepare('SELECT DISTINCT module_id FROM _substrat_migrations ORDER BY module_id')
      .all() as { module_id: string }[];
    db.close();
    expect(rows.map((r) => r.module_id)).toEqual([
      '@substrat-run/engine-invites',
      '@substrat-run/engine-workorder',
      'stride',
    ]);
  });

  it('2. the shared library reaches everyone; Nina\'s private exercise reaches no one else', async () => {
    // The shared catalogue: admin published it, all three tiers can browse it.
    for (const who of [astrid, nina, ola, vera]) {
      const seen = await who.invoke<ExerciseView[]>('stride/exercises');
      expect(slugs(seen)).toEqual(expect.arrayContaining(['back-squat', 'bench-press', 'plank']));
    }

    // Nina sees her own private exercise…
    const hers = await nina.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(hers)).toContain('nordic-hamstring');

    // …Ola does not. He is a fully legitimate coach — he simply holds no grant
    // the walk `exercise → coach:Nina` can reach.
    const his = await ola.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(his)).not.toContain('nordic-hamstring');
    // The control: the door next to it is open — Ola browses the shared library.
    expect(slugs(his)).toContain('back-squat');

    // Vera cannot see it either. YET.
    const veras = await vera.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(veras)).not.toContain('nordic-hamstring');

    // The admin holds `exercise:read` at NODE level, so she reads every coach's
    // private catalogue. This is a deliberate choice, and this is the assertion
    // that will fail the day someone changes their mind about it.
    const adminSees = await astrid.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(adminSees)).toContain('nordic-hamstring');
  });

  it('3. Nina builds her own template and assigns it; the prescription is a SNAPSHOT', async () => {
    const tpl = await nina.invoke<TemplateRow>('stride/author-template', {
      name: 'ACL return-to-play',
      description: "Nina's protocol.",
    });
    aclTemplateId = tpl.id;
    await nina.invoke('stride/add-template-item', {
      templateId: aclTemplateId,
      exerciseId: w.nordicId,
      targetSets: 4,
      targetReps: 8,
      targetLoad: '12.5',
    });
    await nina.invoke('stride/add-template-item', {
      templateId: aclTemplateId,
      exerciseId: w.plankId,
      targetSets: 2,
      targetReps: 30,
    });

    // Ola cannot see Nina's template…
    const olaTemplates = await ola.invoke<TemplateRow[]>('stride/templates');
    expect(olaTemplates.map((t) => t.name)).not.toContain('ACL return-to-play');
    // …control: the shared one is right there.
    expect(olaTemplates.map((t) => t.name)).toContain('Foundation Strength');

    const assigned = await nina.invoke<{ program: WorkOrder; items: ItemRow[] }>(
      'stride/assign-program',
      {
        traineeId: w.veraId,
        title: 'Vera — ACL block 1',
        kind: 'rehab',
        templateId: aclTemplateId,
      },
    );
    veraProgramId = assigned.program.id;
    expect(assigned.program.status).toBe('planned');
    expect(assigned.program.customer).toEqual({ entityType: 'trainee', entityId: w.veraId });
    expect(assigned.items).toHaveLength(2);
    nordicItemId = assigned.items.find((i) => i.exercise_id === w.nordicId)!.id;
    plankItemId = assigned.items.find((i) => i.exercise_id === w.plankId)!.id;

    // Snapshot, not reference: editing the template afterwards leaves Vera's
    // running prescription exactly as it was.
    await nina.invoke('stride/add-template-item', {
      templateId: aclTemplateId,
      exerciseId: w.squatId,
      targetSets: 5,
      targetReps: 5,
      targetLoad: '60',
    });
    const detail = await nina.invoke<ProgramDetail>('stride/get-program', {
      programId: veraProgramId,
    });
    expect(detail.items).toHaveLength(2);
  });

  it('4. THE GUARD: Ola cannot drive a program that is not his, even knowing its id', async () => {
    // Ola holds `workorder:report` at node level — the engine's own check passes.
    // The manifest guard then re-checks `result:log` against the program AS AN
    // ENTITY, and the walk workorder → trainee(Vera) → coach(Nina) does not
    // reach him. Without the guard this call would SUCCEED.
    await expect(ola.invoke('workorder/start', { orderId: veraProgramId })).rejects.toThrow(
      /permission denied: result:log/,
    );
    await expect(
      ola.invoke('workorder/assign', { orderId: veraProgramId, technician: w.ola }),
    ).rejects.toThrow(/permission denied/);

    // The control: the very same call from the very same role succeeds for Nina.
    await expect(nina.invoke('workorder/start', { orderId: veraProgramId })).resolves.toBeTruthy();

    // …and it is not that Ola is broken: he runs his own trainee's program fine.
    const bjornsProgram = await ola.invoke<{ program: WorkOrder }>('stride/assign-program', {
      traineeId: w.bjornId,
      title: 'Björn — Foundation block 1',
      kind: 'strength',
      templateId: w.templateId,
    });
    bjornProgramId = bjornsProgram.program.id;
    await expect(ola.invoke('workorder/start', { orderId: bjornProgramId })).resolves.toBeTruthy();
    const bjornSession = await ola.invoke<SessionRow>('stride/log-session', {
      programId: bjornProgramId,
      note: 'First session',
    });
    bjornSessionId = bjornSession.id;
  });

  it('5. Vera logs her own sets — a trainee writing, gated per entity', async () => {
    const session = await vera.invoke<SessionRow>('stride/log-session', {
      programId: veraProgramId,
      note: 'Knee felt stable',
    });
    // 3 of the 4 prescribed nordic sets…
    for (let i = 0; i < 3; i++) {
      await vera.invoke('stride/log-set', {
        sessionId: session.id,
        programItemId: nordicItemId,
        reps: 8,
        load: '12.5',
        rpe: '7',
      });
    }
    // …and 1 of the 2 prescribed planks.
    await vera.invoke('stride/log-set', {
      sessionId: session.id,
      programItemId: plankItemId,
      reps: 30,
    });

    const detail = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: veraProgramId,
    });
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]!.sets).toHaveLength(4);
    // Append-only and self-numbering per exercise.
    expect(
      detail.sessions[0]!.sets.filter((s) => s.exercise_id === w.nordicId).map((s) => s.set_no),
    ).toEqual([1, 2, 3]);
  });

  it('6. YOURS FOREVER: performing it once earns it — and only for the one who performed it', async () => {
    // Vera now holds it, through the edge `exercise → trainee:Vera` minted when
    // she logged that first set. Not a filter — a permission walk.
    const veras = await vera.invoke<ExerciseRow[]>('stride/my-exercises');
    expect(slugs(veras)).toContain('nordic-hamstring');

    // THE PAIR: Ola still cannot. The edge is to Vera, not to the world.
    const his = await ola.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(his)).not.toContain('nordic-hamstring');

    // Björn has never performed it, so he has not earned it — and the control:
    // he can still browse the shared catalogue.
    const bjorns = await bjorn.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(bjorns)).not.toContain('nordic-hamstring');
    expect(slugs(bjorns)).toContain('back-squat');

    // The first set of an exercise reports `earned`; a later one does not.
    const detail = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: veraProgramId,
    });
    const again = await vera.invoke<{ earned: boolean }>('stride/log-set', {
      sessionId: detail.sessions[0]!.id,
      programItemId: nordicItemId,
      reps: 8,
      load: '12.5',
    });
    expect(again.earned).toBe(false);

    // …and the audit spine recorded the moment it was earned, exactly once.
    const timeline = await vera.invoke<{ type: string }[]>('stride/timeline', {
      entityType: 'exercise',
      entityId: w.nordicId,
    });
    expect(timeline.filter((e) => e.type === 'stride.exercise-earned')).toHaveLength(1);
  });

  it('7. portal isolation: a trainee reaches their own record and nothing else', async () => {
    // Vera sees her program; Björn sees his; neither sees the other's.
    // Vera has more than one programme (the seed books her a Wednesday), so the
    // claim is containment and exclusion, not an exact list — a test that
    // asserted "exactly one" would break every time the world grew a programme
    // and tell you nothing about isolation.
    const veraPrograms = await vera.invoke<ProgramCard[]>('stride/my-programs');
    expect(veraPrograms.map((p) => p.id)).toContain(veraProgramId);
    expect(veraPrograms.map((p) => p.id)).not.toContain(bjornProgramId);
    const bjornPrograms = await bjorn.invoke<ProgramCard[]>('stride/my-programs');
    expect(bjornPrograms.map((p) => p.id)).toContain(bjornProgramId);
    expect(bjornPrograms.map((p) => p.id)).not.toContain(veraProgramId);

    // Vera cannot read Björn's program…
    await expect(
      vera.invoke('stride/get-program', { programId: bjornProgramId }),
    ).rejects.toThrow(/permission denied/);
    // …and cannot WRITE into his session either, knowing its id exactly. This is
    // the entity-narrowed write: most apps would have role-gated this and
    // filtered the read.
    await expect(
      vera.invoke('stride/log-set', {
        sessionId: bjornSessionId,
        programItemId: nordicItemId,
        reps: 8,
      }),
    ).rejects.toThrow(/permission denied: result:log/);
    // The control: the same call into her OWN session is fine (proved in 5/6).

    // A trainee is not staff: publishing and the trainee roster are shut.
    await expect(
      vera.invoke('stride/publish-exercise', {
        slug: 'x',
        name: 'X',
        modality: 'strength',
        unit: 'reps',
      }),
    ).rejects.toThrow(/permission denied: library:publish/);
    // The roster is a WALK, so it is an empty room rather than a slammed door —
    // Vera sees exactly herself.
    const roster = await vera.invoke<TraineeRow[]>('stride/trainees');
    expect(roster.map((t) => t.id)).toEqual([w.veraId]);
  });

  it('8. coach reach: Nina sees her trainee and not Ola\'s', async () => {
    // "My trainees" means the people who ENGAGED me — a live relationship — not
    // the people I happen to have written a programme for. A coach whose trainee
    // has just joined, with no programme yet, must still see them.
    const ninaRoster = await nina.invoke<TraineeRow[]>('stride/trainees');
    expect(ninaRoster.map((t) => t.id)).toEqual([w.veraId]);
    const olaRoster = await ola.invoke<TraineeRow[]>('stride/trainees');
    expect(olaRoster.map((t) => t.id)).toEqual([w.bjornId]);
    // The admin holds it at node level and sees the whole gym.
    const adminRoster = await astrid.invoke<TraineeRow[]>('stride/trainees');
    expect(adminRoster.map((t) => t.id).sort()).toEqual([w.veraId, w.bjornId].sort());

    // Publishing to the organisation is admin-only…
    await expect(
      nina.invoke('stride/publish-exercise', {
        slug: 'gym-wide-thing',
        name: 'Gym-wide thing',
        modality: 'strength',
        unit: 'reps',
      }),
    ).rejects.toThrow(/permission denied: library:publish/);
    // …control: authoring her own is exactly what she may do.
    await expect(
      nina.invoke('stride/author-exercise', {
        slug: 'nina-copenhagen-progression',
        name: 'Copenhagen progression (Nina)',
        modality: 'rehab',
        unit: 'seconds',
        equipment: ['bench'],
      }),
    ).resolves.toBeTruthy();

    // Slugs are unique per gym, shared and private alike — and the clash is a
    // sentence, not a raw constraint error leaking out of SQLite.
    await expect(
      nina.invoke('stride/author-exercise', {
        slug: 'back-squat',
        name: 'My own back squat',
        modality: 'strength',
        unit: 'reps',
      }),
    ).rejects.toThrow(/slug already taken in this gym: back-squat \(shared\)/);
  });

  it('9. RETIRE IS NOT ERASE: the catalogue loses it, the people who did it keep it', async () => {
    await astrid.invoke('stride/retire-exercise', { exerciseId: w.plankId });

    // Gone from the shared catalogue for a coach who never touched it…
    const his = await ola.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(his)).not.toContain('plank');
    // …gone for a trainee who never performed it…
    const bjorns = await bjorn.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(bjorns)).not.toContain('plank');
    // …and STILL THERE for Vera, who performed it in test 5. The
    // `exercise → trainee` edge outlives the catalogue entry.
    const veras = await vera.invoke<ExerciseRow[]>('stride/my-exercises');
    expect(slugs(veras)).toContain('plank');
  });

  it('10. the adherence moment: prescribed vs performed, exact, no floats', async () => {
    const result = await nina.invoke<{ program: WorkOrder; summary: ProgramSummaryRow }>(
      'stride/complete-program',
      { programId: veraProgramId },
    );

    // Prescribed: 4 nordic + 2 plank = 6 sets. Performed: 3 nordic + 1 plank in
    // test 5, plus the 4th nordic in test 6 = 5 sets.
    expect(result.summary.prescribed_sets).toBe(6);
    expect(result.summary.performed_sets).toBe(5);
    expect(result.summary.total_reps).toBe(8 * 4 + 30);

    // Volume computed with the SAME helpers the operation uses — never
    // hand-derived — and then pinned to the human-checkable number.
    const expectedVolume = [1, 2, 3, 4].reduce((sum) => addDecimal(sum, mulDecimal('8', '12.5')), '0');
    expect(result.summary.total_volume).toBe(expectedVolume);
    expect(expectedVolume).toBe('400');

    // 5/6 does not terminate. It is truncated to hundredths as a STRING, so it
    // is 83.33 and never 83.33333333333334.
    expect(result.summary.adherence_pct).toBe('83.33');

    expect(result.program.status).toBe('completed');
  });

  it('11. the engine state machine cannot be skipped or re-entered', async () => {
    // A completed program takes no more sets.
    const detail = await nina.invoke<ProgramDetail>('stride/get-program', {
      programId: veraProgramId,
    });
    await expect(
      vera.invoke('stride/log-set', {
        sessionId: detail.sessions[0]!.id,
        programItemId: nordicItemId,
        reps: 8,
      }),
    ).rejects.toThrow(/invalid transition/);

    // A freshly assigned program is `planned`, and planned → completed is not a
    // legal step. Built without the template on purpose: test 9 retired `plank`,
    // and Nina — who only holds Vera's 'assigned' floor — genuinely cannot read a
    // retired exercise she never authored. Assigning that template would now fail
    // for the RIGHT reason, which is a different test than this one.
    const fresh = await nina.invoke<{ program: WorkOrder }>('stride/assign-program', {
      traineeId: w.veraId,
      title: 'Vera — ACL block 2',
      kind: 'rehab',
    });
    await nina.invoke('stride/add-program-item', {
      programId: fresh.program.id,
      exerciseId: w.nordicId,
      targetSets: 3,
      targetReps: 8,
    });
    await expect(
      nina.invoke('stride/complete-program', { programId: fresh.program.id }),
    ).rejects.toThrow(/invalid transition/);
    // Nor does it take sessions before it starts.
    await expect(
      nina.invoke('stride/log-session', { programId: fresh.program.id }),
    ).rejects.toThrow(/invalid transition/);

    // The control: walked one legal step at a time, the same doors open.
    await nina.invoke('workorder/start', { orderId: fresh.program.id });
    await expect(
      nina.invoke('stride/log-session', { programId: fresh.program.id }),
    ).resolves.toBeTruthy();
  });

  it('12. the cross-tenant attacker gets nothing', async () => {
    // Claiming t1's scope under his OWN tenant fails the (tenant, scope) pair…
    await expect(host.getScope(w.rutger, w.t2, w.s1)).rejects.toThrow(/unknown scope/);
    // …the control: his own pair resolves.
    await expect(host.getScope(w.rutger, w.t2, w.s2)).resolves.toBeTruthy();

    // With the correct pair he can mint a stub but holds no tuples in t1, so
    // every gated operation is denied by the OWNING scope's evaluation…
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(
      rutger.invoke('stride/create-trainee', { number: '9', name: 'Mole' }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      rutger.invoke('stride/get-program', { programId: veraProgramId }),
    ).rejects.toThrow(/permission denied/);
    await expect(rutger.invoke('workorder/list')).rejects.toThrow(/permission denied/);

    // …and the walks return an open door onto an empty room, not a denial.
    await expect(rutger.invoke<TraineeRow[]>('stride/trainees')).resolves.toEqual([]);
    await expect(rutger.invoke<ProgramCard[]>('stride/my-programs')).resolves.toEqual([]);
    await expect(rutger.invoke<ExerciseView[]>('stride/exercises')).resolves.toEqual([]);
  });

  it('13. SELF-SERVE: Björn builds his own exercise and his own program, with no coach', async () => {
    // His own exercise. Nobody prescribed it; he simply made it.
    const kettlebell = await bjorn.invoke<ExerciseRow>('stride/author-exercise', {
      slug: 'kb-swing',
      name: 'Kettlebell swing',
      modality: 'strength',
      unit: 'reps',
      description: 'Björn\'s own.',
    });
    expect(kettlebell.visibility).toBe('private');
    expect(kettlebell.owner_trainee_id).toBe(w.bjornId);
    expect(kettlebell.owner_coach_id).toBeNull();

    // His own program — no traineeId, no template. `workorder:create` is held
    // gym-wide by everyone; the narrowed `result:log` check is what makes it
    // reach exactly one person.
    const own = await bjorn.invoke<{ program: WorkOrder; items: ItemRow[] }>(
      'stride/assign-program',
      { title: 'Saturday conditioning', kind: 'conditioning' },
    );
    expect(own.program.customer.entityId).toBe(w.bjornId);
    expect(own.items).toHaveLength(0);

    const item = await bjorn.invoke<ItemRow>('stride/add-program-item', {
      programId: own.program.id,
      exerciseId: kettlebell.id,
      targetSets: 3,
      targetReps: 20,
      targetLoad: '24',
    });

    // …and he runs it himself, start to finish.
    await bjorn.invoke('workorder/start', { orderId: own.program.id });
    const session = await bjorn.invoke<SessionRow>('stride/log-session', {
      programId: own.program.id,
    });
    for (let i = 0; i < 2; i++) {
      await bjorn.invoke('stride/log-set', {
        sessionId: session.id,
        programItemId: item.id,
        reps: 20,
        load: '24',
      });
    }
    const done = await bjorn.invoke<{ summary: ProgramSummaryRow }>('stride/complete-program', {
      programId: own.program.id,
    });
    expect(done.summary.prescribed_sets).toBe(3);
    expect(done.summary.performed_sets).toBe(2);
    // 2/3 does not terminate: truncated to hundredths as a STRING.
    expect(done.summary.adherence_pct).toBe('66.66');
    expect(done.summary.total_volume).toBe(
      [1, 2].reduce((sum) => addDecimal(sum, mulDecimal('20', '24')), '0'),
    );
    expect(done.summary.total_volume).toBe('960');

    // Making it also earned it — the same edge, so it is his permanently.
    const his = await bjorn.invoke<ExerciseRow[]>('stride/my-exercises');
    expect(slugs(his)).toContain('kb-swing');
  });

  it('14. self-serve is still narrowed: your own means YOUR OWN', async () => {
    // Björn cannot make a program for Vera. He holds `workorder:create` gym-wide
    // like everyone else — the SECOND gate is what stops him.
    await expect(
      bjorn.invoke('stride/assign-program', {
        traineeId: w.veraId,
        title: 'not mine to give',
        kind: 'strength',
      }),
    ).rejects.toThrow(/permission denied: result:log/);
    // The control: for himself, the identical call succeeds.
    await expect(
      bjorn.invoke('stride/assign-program', { title: 'Sunday easy', kind: 'conditioning' }),
    ).resolves.toBeTruthy();

    // Authoring is not publishing. Everyone may make their own; only an admin
    // may put something in front of the whole gym.
    await expect(
      bjorn.invoke('stride/publish-exercise', {
        slug: 'kb-swing-official',
        name: 'Kettlebell swing',
        modality: 'strength',
        unit: 'reps',
      }),
    ).rejects.toThrow(/permission denied: library:publish/);

    // Vera never performed Björn's exercise and holds no grant that reaches it.
    const veras = await vera.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(veras)).not.toContain('kb-swing');

    // Björn's coach CAN read it — but only because Björn chose to share 'all'
    // with Ola in the seed. Under the 'assigned' floor a coach reaches none of a
    // trainee's own exercises. Ola yes…
    const olas = await ola.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(olas)).toContain('kb-swing');
    // …Nina, who does not coach him, no.
    const ninas = await nina.invoke<ExerciseView[]>('stride/exercises');
    expect(slugs(ninas)).not.toContain('kb-swing');

    // And the outsider still gets an empty room.
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(rutger.invoke<ExerciseView[]>('stride/exercises')).resolves.toEqual([]);
    await expect(
      rutger.invoke('stride/assign-program', { title: 'x', kind: 'strength' }),
    ).rejects.toThrow(/permission denied/);
  });

  it('15. the catalogue arrives tagged, and equipment is advice — never a permission', async () => {
    const all = await astrid.invoke<ExerciseView[]>('stride/exercises');
    expect(all.length).toBeGreaterThan(50);

    const squat = all.find((e) => e.slug === 'back-squat')!;
    expect(squat.equipment.sort()).toEqual(['barbell', 'plates', 'squat-rack']);
    // Bodyweight means no rows at all, so it is always doable.
    const pushUp = all.find((e) => e.slug === 'push-up')!;
    expect(pushUp.equipment).toEqual([]);
    expect(pushUp.canDo).toBe(true);

    // Björn's garage: a kettlebell, a bar in a doorway, a mat and a rope.
    const his = await bjorn.invoke<ExerciseView[]>('stride/exercises');
    const kb = his.find((e) => e.slug === 'kettlebell-swing')!;
    expect(kb.canDo).toBe(true);
    const hisSquat = his.find((e) => e.slug === 'back-squat')!;
    expect(hisSquat.canDo).toBe(false);
    expect(hisSquat.missing.sort()).toEqual(['barbell', 'plates', 'squat-rack']);

    // …and the same row for Nina, who works in a full gym.
    const hers = await nina.invoke<ExerciseView[]>('stride/exercises');
    expect(hers.find((e) => e.slug === 'back-squat')!.canDo).toBe(true);

    // THE POINT: equipment never hides anything. Björn can still READ the squat
    // — the kernel decides what he may see, his garage decides what he can lift,
    // and conflating the two would be a bug the day he borrows a barbell.
    expect(his.some((e) => e.slug === 'back-squat')).toBe(true);

    // The vocabulary reads back flagged per account.
    const mine = await bjorn.invoke<EquipmentView[]>('stride/equipment');
    expect(mine.filter((e) => e.available).map((e) => e.slug).sort()).toEqual(
      ['jump-rope', 'kettlebell', 'mat', 'pull-up-bar'].sort(),
    );
    // Nobody else's view changed when he set his own.
    const veras = await vera.invoke<EquipmentView[]>('stride/equipment');
    expect(veras.filter((e) => e.available).map((e) => e.slug).sort()).toEqual(
      ['dumbbells', 'mat', 'resistance-band'].sort(),
    );

    // set-my-equipment takes no id for whose account, so there is no one else to
    // aim it at — but an unknown slug is still refused.
    await expect(
      bjorn.invoke('stride/set-my-equipment', { equipment: ['jetpack'] }),
    ).rejects.toThrow(/unknown equipment: jetpack/);
    // The control: a real one is accepted, and it replaces rather than appends.
    await bjorn.invoke('stride/set-my-equipment', {
      equipment: ['kettlebell', 'pull-up-bar', 'mat', 'jump-rope', 'resistance-band'],
    });
    const after = await bjorn.invoke<EquipmentView[]>('stride/equipment');
    expect(after.filter((e) => e.available)).toHaveLength(5);
  });

  it('16. recurring schedules: due today, done this week, and whose', async () => {
    // Nina prescribes a rehab exercise five times a week — a count, because the
    // days are Vera's to choose — plus a Mon/Wed/Fri strength lift.
    const block = await nina.invoke<{ program: WorkOrder }>('stride/assign-program', {
      traineeId: w.veraId,
      title: 'Vera — ACL block 3',
      kind: 'rehab',
    });
    await nina.invoke('workorder/start', { orderId: block.program.id });
    const daily = await nina.invoke<ItemRow>('stride/add-program-item', {
      programId: block.program.id,
      exerciseId: w.nordicId,
      targetSets: 3,
      targetReps: 8,
      recurPerWeek: 5,
    });
    const shared = await astrid.invoke<ExerciseView[]>('stride/exercises');
    const bandId = shared.find((e) => e.slug === 'band-external-rotation')!.id;
    await nina.invoke('stride/add-program-item', {
      programId: block.program.id,
      exerciseId: bandId,
      targetSets: 2,
      targetReps: 15,
      recurDays: '1,3,5',
    });
    // The two are mutually exclusive: a row that said both would have two
    // answers to "is it due today".
    await expect(
      nina.invoke('stride/add-program-item', {
        programId: block.program.id,
        exerciseId: bandId,
        targetSets: 1,
        targetReps: 1,
        recurDays: '2',
        recurPerWeek: 3,
      }),
    ).rejects.toThrow(/never both/);

    // A Wednesday. The Mon/Wed/Fri item is due; the 5×/week item is due because
    // nothing has been logged yet this week.
    const wed = await vera.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-19' });
    const band = wed.find((i) => i.exerciseId === bandId)!;
    expect(band.dueToday).toBe(true);
    expect(band.targetThisWeek).toBe(3);
    expect(band.doneThisWeek).toBe(0);
    const nordic = wed.find((i) => i.itemId === daily.id)!;
    expect(nordic.targetThisWeek).toBe(5);
    expect(nordic.dueToday).toBe(true);

    // A Tuesday: the named-days item is NOT due, the count-based one still is.
    const tue = await vera.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-18' });
    expect(tue.find((i) => i.exerciseId === bandId)!.dueToday).toBe(false);
    expect(tue.find((i) => i.itemId === daily.id)!.dueToday).toBe(true);

    // Items with no schedule never appear — this is a plan, not an inventory.
    expect(wed.every((i) => i.recurDays !== null || i.recurPerWeek !== null)).toBe(true);

    // Doing it moves the count. "Done" is DISTINCT DAYS, so three sets in one
    // session is one of the five days, not three of them.
    const session = await vera.invoke<SessionRow>('stride/log-session', {
      programId: block.program.id,
    });
    for (let i = 0; i < 3; i++) {
      await vera.invoke('stride/log-set', {
        sessionId: session.id,
        programItemId: daily.id,
        reps: 8,
      });
    }
    const after = await vera.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-19' });
    expect(after.find((i) => i.itemId === daily.id)!.doneThisWeek).toBe(1);

    // And the schedule is a WALK like every other listing: Nina sees her
    // trainee's plan, Ola does not, the outsider gets an empty room.
    const ninaSees = await nina.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-19' });
    expect(ninaSees.some((i) => i.programId === block.program.id)).toBe(true);
    const olaSees = await ola.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-19' });
    expect(olaSees.some((i) => i.programId === block.program.id)).toBe(false);
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(
      rutger.invoke<ScheduledItem[]>('stride/schedule', { on: '2026-08-19' }),
    ).resolves.toEqual([]);
  });

  it('17. SHARING: the trainee decides, and can take it back', async () => {
    // Vera is on the default floor with Nina: Nina may prescribe, and sees the
    // programmes she wrote — carried by the workorder → coach edge, not by any
    // claim over Vera herself.
    const before = await vera.invoke<SharingView[]>('stride/my-sharing');
    expect(before.map((s) => [s.coachName, s.mode])).toEqual([['Nina Ljung', 'assigned']]);

    // Vera makes a programme of her OWN. Nina did not write it, so on the floor
    // she cannot see it…
    const mine = await vera.invoke<{ program: WorkOrder }>('stride/assign-program', {
      title: 'Vera — my own week',
      kind: 'strength',
    });
    await vera.invoke('workorder/start', { orderId: mine.program.id });
    const privateSession = await vera.invoke<SessionRow>('stride/log-session', {
      programId: mine.program.id,
      note: 'before sharing',
    });
    await expect(
      nina.invoke('stride/get-program', { programId: mine.program.id }),
    ).rejects.toThrow(/permission denied/);
    // …the control: the programme Nina DID write is still hers to read.
    await expect(
      nina.invoke('stride/get-program', { programId: veraProgramId }),
    ).resolves.toBeTruthy();

    // 'from-now' — nothing retroactive. The session Vera logged a moment ago
    // stays private; the next one does not.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'from-now' });
    const later = await vera.invoke<SessionRow>('stride/log-session', {
      programId: mine.program.id,
      note: 'after sharing',
    });
    const ninaSees = await nina.invoke<ProgramDetail>('stride/get-program', {
      programId: mine.program.id,
    });
    expect(ninaSees.sessions.map((s) => s.id)).toEqual([later.id]);
    expect(ninaSees.sessions.map((s) => s.note)).toEqual(['after sharing']);
    // Vera herself still sees both — the walk from her own record reaches
    // everything, which is what makes this a SHARE and not a deletion.
    const veraSees = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: mine.program.id,
    });
    expect(veraSees.sessions.map((s) => s.id)).toEqual([privateSession.id, later.id]);

    // 'all' — the past opens up too.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'all' });
    const withAll = await nina.invoke<ProgramDetail>('stride/get-program', {
      programId: mine.program.id,
    });
    expect(withAll.sessions.map((s) => s.id)).toEqual([privateSession.id, later.id]);

    // …and back down. THIS is the assertion that matters: a downgrade genuinely
    // withdraws, rather than adding a narrower rule on top of a wider grant.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
    await expect(
      nina.invoke('stride/get-program', { programId: mine.program.id }),
    ).rejects.toThrow(/permission denied/);

    // 'none' ends it: Nina can no longer even prescribe.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'none' });
    await expect(
      nina.invoke('stride/assign-program', {
        traineeId: w.veraId,
        title: 'not any more',
        kind: 'rehab',
      }),
    ).rejects.toThrow(/permission denied: result:log/);
    expect(await vera.invoke<SharingView[]>('stride/my-sharing')).toEqual([]);
    // The honest limit, asserted so nobody is surprised by it: the programme
    // Nina already wrote stays hers. `ctx.link` has no un-link.
    await expect(
      nina.invoke('stride/get-program', { programId: veraProgramId }),
    ).resolves.toBeTruthy();

    // Put it back so later tests have a coach.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
  });

  it('18. sharing is yours alone: nobody can share on your behalf', async () => {
    // There is no id for whose sharing — it is the caller's — so a coach cannot
    // open a trainee's data by calling the same operation.
    await expect(
      nina.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'all' }),
    ).rejects.toThrow(/permission denied: share:manage/);
    // Nor can another trainee.
    await expect(
      bjorn.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'all' }),
    ).resolves.toBeTruthy(); // …he can share HIS OWN with Nina, which reveals nothing of Vera's
    const ninaRoster = await nina.invoke<TraineeRow[]>('stride/trainees');
    expect(ninaRoster.some((t) => t.id === w.bjornId)).toBe(true);
    await bjorn.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'none' });
    const after = await nina.invoke<TraineeRow[]>('stride/trainees');
    expect(after.some((t) => t.id === w.bjornId)).toBe(false);
  });

  it('19. INVITES: hashed, accept-required, and non-enumerable', async () => {
    // A coach invites a trainee. The reply is an id and nothing else — it will
    // not say whether that address is already here.
    const invite = await nina.invoke<{ id: string }>('stride/invite', {
      identifier: 'Ingrid@Example.test',
      as: 'trainee',
    });
    expect(Object.keys(invite)).toEqual(['id']);

    const listed = await nina.invoke<{ id: string; state: string }[]>('stride/invitations');
    const row = listed.find((i) => i.id === invite.id)!;
    expect(row.state).toBe('invited');
    // The hash never leaves the engine.
    expect(Object.keys(row)).not.toContain('identifier_hash');

    // An invitation id alone is not a bearer token: the identifier is re-hashed.
    const ingridPrincipal = principalId.parse(ulid());
    const ingrid = await host.getScope(ingridPrincipal, w.t1, w.s1);
    await expect(
      ingrid.invoke('stride/accept-invite', {
        invitationId: invite.id,
        identifier: 'someone-else@example.test',
        name: 'Impostor',
      }),
    ).rejects.toThrow();

    // The control: the real identifier, normalised (case and spacing) by the
    // engine, is accepted — and creates the trainee record plus the default floor.
    const accepted = await ingrid.invoke<{ as: string; recordId: string; sharedWithInviter: boolean }>(
      'stride/accept-invite',
      { invitationId: invite.id, identifier: '  ingrid@example.test ', name: 'Ingrid Sund' },
    );
    expect(accepted.as).toBe('trainee');
    expect(accepted.sharedWithInviter).toBe(true);

    // Until the platform drains the intent she is a record with no permissions —
    // the correct intermediate state, not a bug.
    await expect(ingrid.invoke('stride/my-sharing')).rejects.toThrow(/permission denied/);
    expect(await drainPlatformRequests(host, w.t1, w.s1)).toBe(1);
    // …and now she is a person in the gym.
    await expect(ingrid.invoke('stride/my-sharing')).resolves.toHaveLength(1);

    // Accepted once, settled for good.
    await expect(
      ingrid.invoke('stride/accept-invite', {
        invitationId: invite.id,
        identifier: 'ingrid@example.test',
        name: 'Ingrid Sund',
      }),
    ).rejects.toThrow();

    // Nina may now prescribe to her, on the floor — and Ola may not.
    await expect(
      nina.invoke('stride/assign-program', {
        traineeId: accepted.recordId,
        title: 'Ingrid — intake',
        kind: 'strength',
      }),
    ).resolves.toBeTruthy();
    await expect(
      ola.invoke('stride/assign-program', {
        traineeId: accepted.recordId,
        title: 'poach',
        kind: 'strength',
      }),
    ).rejects.toThrow(/permission denied: result:log/);
  });

  it('20. invites run the other way too, and the direction is checked', async () => {
    // A trainee invites a coach.
    const invite = await bjorn.invoke<{ id: string }>('stride/invite', {
      identifier: 'petra@example.test',
      as: 'coach',
    });
    const petraPrincipal = principalId.parse(ulid());
    const petra = await host.getScope(petraPrincipal, w.t1, w.s1);
    const accepted = await petra.invoke<{ as: string; recordId: string; sharedWithInviter: boolean }>(
      'stride/accept-invite',
      { invitationId: invite.id, identifier: 'petra@example.test', name: 'Petra Nyman' },
    );
    expect(accepted.as).toBe('coach');
    await drainPlatformRequests(host, w.t1, w.s1);
    // NOTHING is shared by accepting. Only the trainee can open their own data,
    // and a default invented on their behalf would be that decision taken from
    // them — so Petra can do nothing until Björn says so.
    expect(accepted.sharedWithInviter).toBe(false);

    // A coach cannot invite another coach, and a trainee cannot invite a trainee.
    await expect(
      nina.invoke('stride/invite', { identifier: 'x@example.test', as: 'coach' }),
    ).rejects.toThrow(/a coach invites trainees/);
    await expect(
      bjorn.invoke('stride/invite', { identifier: 'y@example.test', as: 'trainee' }),
    ).rejects.toThrow(/a trainee invites a coach/);

    // The cross-tenant attacker holds no invite permission here at all.
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(
      rutger.invoke('stride/invite', { identifier: 'z@example.test', as: 'trainee' }),
    ).rejects.toThrow(/permission denied/);
  });

  it('21. sets and supersets: a ramp stays a ramp when it is snapshot', async () => {
    const templates = await vera.invoke<TemplateRow[]>('stride/templates');
    const push = templates.find((t) => t.name.includes('ramp'))!;
    // A trainee can start from one of the GYM'S templates, not only their own.
    const own = await vera.invoke<{ program: WorkOrder; items: ItemRow[] }>(
      'stride/assign-program',
      { title: 'Upper push', kind: 'strength', templateId: push.id },
    );
    // …and start it herself: she holds `workorder:report` and the guard passes
    // on her own programme. (The UI used to hide this button behind a staff
    // check — the kernel never did.)
    await expect(vera.invoke('workorder/start', { orderId: own.program.id })).resolves.toBeTruthy();

    const detail = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: own.program.id,
    });
    const bench = detail.items.find((i) => i.exercise?.slug === 'bench-press')!;
    // The RAMP survived the snapshot set for set — copied as "4 × something" it
    // would be a different session.
    expect(bench.sets.map((s) => [s.set_no, s.target_reps, s.target_load])).toEqual([
      [1, 10, '40'],
      [2, 8, '45'],
      [3, 6, '50'],
      [4, 4, '55'],
    ]);
    expect(bench.sets[0]!.note).toBe('warm-up');
    // …and `target_sets` agrees with it, so adherence and the schedule — which
    // know nothing about the per-set table — still read the right number.
    expect(bench.target_sets).toBe(4);

    // The SUPERSET survived too: two items, same key, adjacent.
    const grouped = detail.items.filter((i) => i.group_key === 'A');
    expect(grouped).toHaveLength(2);
    expect(grouped.map((i) => i.exercise?.slug)).toEqual([
      'dumbbell-shoulder-press',
      'dumbbell-row',
    ]);
    expect(bench.group_key).toBeNull();

    // Rewriting the sets on her own programme is hers to do…
    const res = await vera.invoke<{ sets: ItemSetRow[] }>('stride/set-item-sets', {
      itemId: bench.id,
      sets: [
        { reps: 12, load: '35' },
        { reps: 10, load: '40' },
      ],
    });
    expect(res.sets).toHaveLength(2);
    const after = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: own.program.id,
    });
    expect(after.items.find((i) => i.id === bench.id)!.target_sets).toBe(2);

    // …and not Björn's, even knowing the item id.
    await expect(
      bjorn.invoke('stride/set-item-sets', {
        itemId: bench.id,
        sets: [{ reps: 1 }],
      }),
    ).rejects.toThrow(/permission denied: result:log/);

    // A finished prescription does not move: it is what adherence measured.
    await vera.invoke('stride/log-session', { programId: own.program.id });
    await vera.invoke('stride/complete-program', { programId: own.program.id });
    await expect(
      vera.invoke('stride/set-item-sets', { itemId: bench.id, sets: [{ reps: 5 }] }),
    ).rejects.toThrow(/invalid transition/);
  });

  it('22. onboarding: two answers, and only about yourself', async () => {
    // Seeded for Vera, deliberately absent for Björn — most people on day one.
    const veraMe = await vera.invoke<TraineeRow>('stride/me');
    expect([veraMe.goal, veraMe.days_per_week]).toEqual(['rehab', 5]);
    const bjornBefore = await bjorn.invoke<TraineeRow>('stride/me');
    expect(bjornBefore.onboarded_at).toBeNull();

    const bjornAfter = await bjorn.invoke<TraineeRow>('stride/onboard', {
      goal: 'muscle',
      daysPerWeek: 4,
    });
    expect([bjornAfter.goal, bjornAfter.days_per_week]).toEqual(['muscle', 4]);
    expect(bjornAfter.onboarded_at).not.toBeNull();
    // Vera's answers are untouched — there is no id for whose, so there was
    // never anyone else's to touch.
    expect((await vera.invoke<TraineeRow>('stride/me')).goal).toBe('rehab');

    // A coach has nothing to onboard, and is refused at the permission rather
    // than at the record lookup.
    await expect(
      nina.invoke('stride/onboard', { goal: 'muscle', daysPerWeek: 4 }),
    ).rejects.toThrow(/permission denied: share:manage/);
    // The control: `stride/me` is harmless for anyone and simply says null.
    await expect(nina.invoke('stride/me')).resolves.toBeNull();

    // Nonsense is refused at the boundary.
    await expect(
      bjorn.invoke('stride/onboard', { goal: 'muscle', daysPerWeek: 9 }),
    ).rejects.toThrow();
    await expect(
      bjorn.invoke('stride/onboard', { goal: 'winning', daysPerWeek: 3 }),
    ).rejects.toThrow();
  });

  it('23. CARDIO: one quantity in the exercise\'s own unit, plus the time it took', async () => {
    const all = await vera.invoke<ExerciseView[]>('stride/exercises');
    expect(all.filter((e) => e.modality === 'cardio').length).toBeGreaterThanOrEqual(20);
    // Outdoors needs nothing, which is the point of tagging equipment at all.
    const run = all.find((e) => e.slug === 'run-outdoor')!;
    expect(run.equipment).toEqual([]);
    expect(run.canDo).toBe(true);

    const rowing = all.find((e) => e.slug === 'rowing')!;
    expect(rowing.unit).toBe('metres');

    const program = await vera.invoke<{ program: WorkOrder }>('stride/assign-program', {
      title: 'Conditioning',
      kind: 'conditioning',
    });
    const item = await vera.invoke<ItemRow>('stride/add-program-item', {
      programId: program.program.id,
      exerciseId: rowing.id,
      targetSets: 1,
      targetReps: 5000, // metres — the unit is the exercise's, not the column's
    });
    await vera.invoke('workorder/start', { orderId: program.program.id });
    const session = await vera.invoke<SessionRow>('stride/log-session', {
      programId: program.program.id,
    });
    await vera.invoke('stride/log-set', {
      sessionId: session.id,
      programItemId: item.id,
      reps: 5000,
      durationSeconds: 22 * 60,
      avgHr: 148,
    });

    const detail = await vera.invoke<ProgramDetail>('stride/get-program', {
      programId: program.program.id,
    });
    const set = detail.sessions[0]!.sets[0]!;
    expect([set.reps, set.duration_seconds, set.avg_hr]).toEqual([5000, 1320, 148]);
    // No load, so no volume — cardio's work is time, and the summary says so
    // instead of reporting "0" as though nothing happened.
    expect(set.load).toBeNull();

    const done = await vera.invoke<{ summary: ProgramSummaryRow }>('stride/complete-program', {
      programId: program.program.id,
    });
    expect(done.summary.total_volume).toBe('0');
    expect(done.summary.total_seconds).toBe(1320);
    expect(done.summary.total_reps).toBe(5000);

    // Nonsense is refused at the boundary rather than stored.
    const p2 = await vera.invoke<{ program: WorkOrder }>('stride/assign-program', {
      title: 'Conditioning 2',
      kind: 'conditioning',
    });
    const i2 = await vera.invoke<ItemRow>('stride/add-program-item', {
      programId: p2.program.id,
      exerciseId: rowing.id,
      targetSets: 1,
      targetReps: 2000,
    });
    await vera.invoke('workorder/start', { orderId: p2.program.id });
    const s2 = await vera.invoke<SessionRow>('stride/log-session', { programId: p2.program.id });
    await expect(
      vera.invoke('stride/log-set', {
        sessionId: s2.id,
        programItemId: i2.id,
        reps: 2000,
        avgHr: 400,
      }),
    ).rejects.toThrow();
    // The control: a plausible one is accepted.
    await expect(
      vera.invoke('stride/log-set', {
        sessionId: s2.id,
        programItemId: i2.id,
        reps: 2000,
        avgHr: 160,
      }),
    ).resolves.toBeTruthy();
  });

  it('24. booked training: Wednesday at 11, and one tap to begin', async () => {
    const agenda = await vera.invoke<AgendaEntry[]>('stride/agenda', { on: '2026-08-19' });
    const wed = agenda.find((a) => a.weekday === 3)!;
    expect([wed.weekday, wed.time, wed.dueToday]).toEqual([3, '11:00', true]);
    // Saturday is booked too, and is not due on a Wednesday.
    expect(agenda.find((a) => a.weekday === 6)!.dueToday).toBe(false);
    // Sorted, so "next up" is just the first row.
    expect(agenda.map((a) => `${a.weekday}@${a.time}`)).toEqual(['3@11:00', '6@09:00']);
    expect(wed.sessionToday).toBeNull();

    // ONE TAP. No session existed, so one is opened…
    const first = await vera.invoke<{ session: SessionRow; resumed: boolean }>('stride/begin', {
      programId: wed.programId,
    });
    expect(first.resumed).toBe(false);
    // …and pressing it again the same day RESUMES rather than fragmenting the
    // workout into two sessions.
    const again = await vera.invoke<{ session: SessionRow; resumed: boolean }>('stride/begin', {
      programId: wed.programId,
    });
    expect(again.resumed).toBe(true);
    expect(again.session.id).toBe(first.session.id);

    // It composes the operations rather than bypassing them: a programme that
    // has not started is refused, not quietly started — `workorder/start` carries
    // the manifest guard, and a shortcut around it would be the hole the guard
    // exists to close.
    const fresh = await vera.invoke<{ program: WorkOrder }>('stride/assign-program', {
      title: 'Not started yet',
      kind: 'strength',
    });
    await expect(
      vera.invoke('stride/begin', { programId: fresh.program.id }),
    ).rejects.toThrow(/start it first/);

    // Booking is the same door as logging: Björn cannot schedule Vera's training.
    await expect(
      bjorn.invoke('stride/set-program-slots', {
        programId: wed.programId,
        slots: [{ weekday: 1, time: '06:00' }],
      }),
    ).rejects.toThrow(/permission denied: result:log/);
    // Nor can he begin it.
    await expect(
      bjorn.invoke('stride/begin', { programId: wed.programId }),
    ).rejects.toThrow(/permission denied: result:log/);

    // Picking the same slot twice is a slip, not something to refuse.
    const saved = await vera.invoke<{ slots: unknown[] }>('stride/set-program-slots', {
      programId: wed.programId,
      slots: [
        { weekday: 3, time: '11:00' },
        { weekday: 3, time: '11:00' },
        { weekday: 5, time: '18:30' },
      ],
    });
    expect(saved.slots).toHaveLength(2);
    // A malformed time is refused at the boundary.
    await expect(
      vera.invoke('stride/set-program-slots', {
        programId: wed.programId,
        slots: [{ weekday: 3, time: '25:00' }],
      }),
    ).rejects.toThrow();

    // And the agenda is a walk: the outsider sees an empty book.
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(rutger.invoke<AgendaEntry[]>('stride/agenda')).resolves.toEqual([]);
  });

  it('25. TRAINING ALONE: no coach, no assignment, no completion ceremony', async () => {
    // Björn shared everything with Ola in the seed. He can end that outright —
    // a coach is something you add, and something you can drop.
    await bjorn.invoke('stride/set-sharing', { coachId: w.olaId, mode: 'none' });
    expect(await bjorn.invoke<SharingView[]>('stride/my-sharing')).toEqual([]);

    // Two workouts he rotates, each booked as it is created — one call, not
    // "create it, then find it, then schedule it".
    const made: string[] = [];
    for (const [title, slots] of [
      ['Workout A', [{ weekday: 1, time: '18:00' }, { weekday: 5, time: '18:00' }]],
      ['Workout B', [{ weekday: 3, time: '18:00' }]],
    ] as const) {
      const r = await bjorn.invoke<{ program: WorkOrder }>('stride/assign-program', {
        title,
        kind: 'strength',
        slots,
      });
      await bjorn.invoke('workorder/start', { orderId: r.program.id });
      made.push(r.program.id);
    }

    // ROTATION needs no new concept: A on Monday and Friday, B on Wednesday is
    // just two sets of slots.
    const agenda = await bjorn.invoke<AgendaEntry[]>('stride/agenda', { on: '2026-08-19' });
    const mine = agenda.filter((a) => made.includes(a.programId));
    expect(mine.map((a) => `${DAYS[a.weekday]} ${a.programTitle}`)).toEqual([
      'Mon Workout A',
      'Wed Workout B',
      'Fri Workout A',
    ]);
    // A Wednesday: B is what is on today.
    expect(mine.filter((a) => a.dueToday).map((a) => a.programTitle)).toEqual(['Workout B']);

    // He trains it, week after week, and NEVER completes it. A standing workout
    // that is still `in_progress` a month later is the normal case, not a
    // half-finished one.
    const b = mine.find((a) => a.dueToday)!;
    const kb = (await bjorn.invoke<ExerciseView[]>('stride/exercises')).find(
      (e) => e.slug === 'kettlebell-swing',
    )!;
    const item = await bjorn.invoke<ItemRow>('stride/add-program-item', {
      programId: b.programId,
      exerciseId: kb.id,
      targetSets: 3,
      targetReps: 20,
    });
    const begun = await bjorn.invoke<{ session: SessionRow; resumed: boolean }>('stride/begin', {
      programId: b.programId,
    });
    await bjorn.invoke('stride/log-set', {
      sessionId: begun.session.id,
      programItemId: item.id,
      reps: 20,
      load: '24',
    });
    const detail = await bjorn.invoke<ProgramDetail>('stride/get-program', {
      programId: b.programId,
    });
    expect(detail.program.status).toBe('in_progress');
    expect(detail.slots.map((s) => `${s.weekday}@${s.time_of_day}`)).toEqual(['3@18:00']);
    expect(detail.sessions[0]!.sets).toHaveLength(1);

    // And nobody else is anywhere near it — training alone means alone.
    await expect(
      nina.invoke('stride/get-program', { programId: b.programId }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ola.invoke('stride/get-program', { programId: b.programId }),
    ).rejects.toThrow(/permission denied/);
  });

  it('26. CHAT: the thread lives and dies with the coaching relationship', async () => {
    // Seeded with a message each way, so the inbox is a conversation not a form.
    const inbox = await vera.invoke<ThreadView[]>('stride/threads');
    expect(inbox.map((t) => t.coachName)).toEqual(['Nina Ljung']);
    const thread = inbox[0]!;

    const opened = await vera.invoke<{ messages: MessageRow[]; me: string }>('stride/messages', {
      traineeId: thread.traineeId,
      coachId: thread.coachId,
    });
    expect(opened.messages).toHaveLength(2);
    // Reading marked it read, so it is not still shouting at her.
    expect((await vera.invoke<ThreadView[]>('stride/threads'))[0]!.unread).toBe(0);

    await vera.invoke('stride/post-message', {
      traineeId: thread.traineeId,
      coachId: thread.coachId,
      body: 'Will do — thanks!',
    });
    // …and it lands as unread for the OTHER side only.
    const ninaInbox = await nina.invoke<ThreadView[]>('stride/threads');
    expect(ninaInbox.find((t) => t.traineeId === thread.traineeId)!.unread).toBe(1);
    expect((await vera.invoke<ThreadView[]>('stride/threads'))[0]!.unread).toBe(0);

    // Ola coaches Björn, not Vera. He is a legitimate coach and still cannot
    // read a word of this — the key is narrowed to the trainee it is about.
    await expect(
      ola.invoke('stride/messages', { traineeId: thread.traineeId, coachId: thread.coachId }),
    ).rejects.toThrow(/permission denied: message:read/);
    await expect(
      ola.invoke('stride/post-message', {
        traineeId: thread.traineeId,
        coachId: thread.coachId,
        body: 'butting in',
      }),
    ).rejects.toThrow(/permission denied: message:post/);
    // Nor can another trainee, and his own inbox does not mention her.
    await expect(
      bjorn.invoke('stride/messages', { traineeId: thread.traineeId, coachId: thread.coachId }),
    ).rejects.toThrow(/permission denied: message:read/);
    const bjornInbox = await bjorn.invoke<ThreadView[]>('stride/threads');
    expect(bjornInbox.some((t) => t.traineeId === thread.traineeId)).toBe(false);

    // A coach may talk to a trainee on the STRICTEST sharing setting: the
    // conversation is not the training, which is why the message keys ride the
    // relationship rather than the mode.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
    await expect(
      nina.invoke('stride/post-message', {
        traineeId: thread.traineeId,
        coachId: thread.coachId,
        body: 'How did Tuesday go?',
      }),
    ).resolves.toBeTruthy();

    // …and ENDING it closes the conversation. For both of them: the coach can no
    // longer read or write, and the thread leaves her inbox too.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'none' });
    await expect(
      nina.invoke('stride/messages', { traineeId: thread.traineeId, coachId: thread.coachId }),
    ).rejects.toThrow(/permission denied: message:read/);
    expect(await vera.invoke<ThreadView[]>('stride/threads')).toEqual([]);

    // Reconnecting reopens it, with the history intact — the messages were never
    // deleted, only made unreachable.
    await vera.invoke('stride/set-sharing', { coachId: w.ninaId, mode: 'assigned' });
    const again = await nina.invoke<{ messages: MessageRow[] }>('stride/messages', {
      traineeId: thread.traineeId,
      coachId: thread.coachId,
    });
    expect(again.messages).toHaveLength(4);

    // The cross-tenant attacker gets an empty room, as everywhere else.
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(rutger.invoke<ThreadView[]>('stride/threads')).resolves.toEqual([]);
  });

  it('27. WHO AM I: the role is the record, and a stranger is refused outright', async () => {
    // The deployed app has no dev cast to ask — it asks the kernel. Staff, member
    // and admin are told apart by which record carries their principal, never by a
    // column called `role`.
    const her = await vera.invoke<WhoAmI>('stride/whoami');
    expect(her.role).toBe('trainee');
    expect(her.name).toBe('Vera Holm');
    expect(her.recordId).toBeTruthy();

    const hers = await nina.invoke<WhoAmI>('stride/whoami');
    expect(hers.role).toBe('coach');
    expect(hers.recordId).toBeTruthy();

    // An admin is neither record — and is not made into an empty trainee for the
    // sake of a tidier shape.
    const theirs = await astrid.invoke<WhoAmI>('stride/whoami');
    expect(theirs.role).toBe('admin');
    expect(theirs.recordId).toBeNull();

    // The one that matters: a valid principal from the OTHER gym holds no role
    // here, so the question itself is denied. Signing in is not membership, and
    // this is the call the app makes before it renders anything.
    const rutger = await host.getScope(w.rutger, w.t1, w.s1);
    await expect(rutger.invoke<WhoAmI>('stride/whoami')).rejects.toThrow(
      /permission denied: exercise:read-shared/,
    );
  });
});
