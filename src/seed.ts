import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  orgId,
  platformActorId,
  principalId,
  scopeId,
  tenantId,
  type PermissionKey,
  type PrincipalId,
  type RoleDefinition,
  type ScopeId,
  type TenantId,
} from '@substrat-run/contracts';
import { ulid } from '@substrat-run/kernel';
import { SqliteScopeHost } from '@substrat-run/adapter-sqlite';
import { PERM as WO } from '@substrat-run/engine-workorder';
import { TRAIN_PERM } from './manifest.js';
import {
  coachEntityPerms,
  traineeEntityPerms,
  MODULES,
  ROLES,
} from './modules.js';

// The module set, role table and grant shapes live in `modules.ts` — shared with
// the deployed worker, which cannot import this file (it would drag SQLite into
// a Durable Object bundle). Re-exported so existing callers are unaffected.
export { MODULES, ROLES, ENTITY_GRANTS } from './modules.js';
import { DEV_PROVIDER, SUB } from './personas.js';

// ============================================================================
// The seeded world. TWO tenants on purpose: the first is the gym the scenario
// exercises; the second exists only so its admin can reach across and be turned
// away. A cross-tenant attacker is the cheapest possible proof that isolation
// is real rather than claimed.
//
// Inside tenant 1 there are TWO coaches, also on purpose: Nina's private
// exercises and Nina's trainees must be invisible to Ola, and that is only
// provable with a second coach who is otherwise fully legitimate.
// ============================================================================

export interface StrideWorld {
  t1: TenantId; // Nordkraft Träning & Rehab — the gym under test
  s1: ScopeId;
  t2: TenantId; // Sydpuls Gym — unrelated
  s2: ScopeId;

  astrid: PrincipalId; // admin @ t1
  nina: PrincipalId; // coach @ t1 — Vera's coach
  ola: PrincipalId; // coach @ t1 — Björn's coach
  vera: PrincipalId; // trainee @ t1
  bjorn: PrincipalId; // trainee @ t1
  rutger: PrincipalId; // admin @ t2 — the cross-tenant attacker
  /**
   * A real principal with NO records and NO role, so the invite flow can be
   * driven end to end in the dev UI. Holds nothing until an invitation is
   * accepted — which is the whole point of accept-required invitations.
   */
  newcomer: PrincipalId;

  ninaId: string; // coach record ids
  olaId: string;
  veraId: string; // trainee record ids
  bjornId: string;
  squatId: string; // shared exercises
  benchId: string;
  plankId: string;
  nordicId: string; // Nina's PRIVATE exercise — the one Vera will earn
  templateId: string; // the shared "Foundation Strength" template
}

// ============================================================================
// THE PLATFORM SIDE. Harness, not module code — it holds `HostAdmin` authority,
// which is exactly why module code may not.
//
// A vertical that needs a privileged act (assign a role, mint someone's first
// entity grants) enqueues a typed INTENT with `ctx.requestPlatform`, atomic with
// its own transaction. The platform pulls and executes it. On the hosted
// platform that drain is the control plane; locally it is this function, called
// by the server after each request and by the tests explicitly.
// ============================================================================

interface OnboardPayload {
  principal: string;
  as: 'coach' | 'trainee';
  recordId: string;
  roleKey: string;
  inviterCoachPrincipal: string | null;
}

/** Execute every pending intent in a scope. Returns how many settled. */
export async function drainPlatformRequests(
  host: SqliteScopeHost,
  tenant: TenantId,
  scope: ScopeId,
): Promise<number> {
  const staff = platformActorId.parse(ulid());
  const pending = await host.listPlatformRequests(tenant, scope);
  let settled = 0;
  for (const request of pending) {
    try {
      if (request.kind !== 'stride:onboard') {
        throw new Error(`no handler for platform intent kind: ${request.kind}`);
      }
      const p = request.payload as OnboardPayload;
      const principal = principalId.parse(p.principal);

      await host.admin.assignRole(staff, {
        principalId: principal,
        roleKey: p.roleKey,
        node: { tenantId: tenant, scopeId: scope },
      });

      // The new person's grants on their OWN record — the thing they had nothing
      // of a moment ago, and the reason this had to be an intent.
      const own = p.as === 'coach' ? coachEntityPerms : traineeEntityPerms;
      for (const permission of own) {
        await host.admin.grant(staff, {
          principalId: principal,
          permission,
          node: { tenantId: tenant, scopeId: scope },
          entity: { entityType: p.as, entityId: p.recordId },
          grantedBy: principal,
        });
      }

      // The default floor with the coach who invited them. This is the trainee's
      // own decision — accepting that invitation WAS the decision — executed by
      // the platform because at the moment of accepting they held nothing to
      // delegate. Everything after this they change themselves.
      if (p.as === 'trainee' && p.inviterCoachPrincipal) {
        await host.admin.grant(staff, {
          principalId: principalId.parse(p.inviterCoachPrincipal),
          permission: TRAIN_PERM.resultLog,
          node: { tenantId: tenant, scopeId: scope },
          entity: { entityType: 'trainee', entityId: p.recordId },
          grantedBy: principal,
        });
      }

      await host.settlePlatformRequest(tenant, scope, request.id, { status: 'done' });
      settled += 1;
    } catch (err) {
      await host.settlePlatformRequest(tenant, scope, request.id, {
        status: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return settled;
}

export function buildStrideHost(dir: string): SqliteScopeHost {
  const host = new SqliteScopeHost({ dir });
  for (const m of MODULES) host.registerModule(m);
  return host;
}

/**
 * Provision ONE gym: tenant, entitlements for every module it runs, an active
 * scope, the role table, and the owner holding admin. This is what an
 * instantiate button would call — no demo cast, no fixtures.
 */
async function provisionGym(
  host: SqliteScopeHost,
  input: { tenantId: TenantId; scopeId: ScopeId; owner: PrincipalId; slug: string; name: string },
): Promise<void> {
  const staff = platformActorId.parse(ulid());
  await host.admin.createTenant(staff, { id: input.tenantId, slug: input.slug, name: input.name });
  // Entitlements are default-deny: the SKU flag for each module this vertical
  // runs must be granted before any of its operations resolve.
  for (const key of ['workorder', 'invites', 'stride']) {
    await host.admin.grantEntitlement(staff, input.tenantId, key);
  }
  await host.provisionScope(staff, {
    tenantId: input.tenantId,
    scopeId: input.scopeId,
    jurisdiction: 'global',
  });
  await host.admin.activateScope(staff, input.tenantId, input.scopeId);
  // engine-invites keys invitations by ORG. This vertical has no
  // sub-organisations, so the scope IS the org — a deterministic id the module
  // code derives from `ctx.scopeId` rather than being told.
  await host.admin.createOrg(staff, {
    id: orgId.parse(input.scopeId),
    tenantId: input.tenantId,
    slug: input.slug,
    name: input.name,
  });
  for (const role of ROLES) await host.admin.defineRole(staff, input.tenantId, role);
  await host.admin.assignRole(staff, {
    principalId: input.owner,
    roleKey: 'admin',
    node: { tenantId: input.tenantId, scopeId: null },
  });
}

/**
 * Idempotent seed. Everything that mutates the control plane runs only on a
 * FRESH data dir (guarded by cast.json); on restart the tenants, roles, grants
 * and entities are already in the SQLite files, so we just rebuild the handle
 * object. Safe to call on every server start and on every test.
 */
export async function seedStride(host: SqliteScopeHost, dir: string): Promise<StrideWorld> {
  const castPath = join(dir, 'cast.json');
  if (existsSync(castPath)) {
    const raw = JSON.parse(readFileSync(castPath, 'utf8')) as Record<string, string>;
    return {
      t1: tenantId.parse(raw.t1),
      s1: scopeId.parse(raw.s1),
      t2: tenantId.parse(raw.t2),
      s2: scopeId.parse(raw.s2),
      astrid: principalId.parse(raw.astrid),
      nina: principalId.parse(raw.nina),
      ola: principalId.parse(raw.ola),
      vera: principalId.parse(raw.vera),
      bjorn: principalId.parse(raw.bjorn),
      rutger: principalId.parse(raw.rutger),
      newcomer: principalId.parse(raw.newcomer),
      ninaId: raw.ninaId!,
      olaId: raw.olaId!,
      veraId: raw.veraId!,
      bjornId: raw.bjornId!,
      squatId: raw.squatId!,
      benchId: raw.benchId!,
      plankId: raw.plankId!,
      nordicId: raw.nordicId!,
      templateId: raw.templateId!,
    };
  }

  const staff = platformActorId.parse(ulid());
  const world: StrideWorld = {
    t1: tenantId.parse(ulid()),
    s1: scopeId.parse(ulid()),
    t2: tenantId.parse(ulid()),
    s2: scopeId.parse(ulid()),
    astrid: principalId.parse(ulid()),
    nina: principalId.parse(ulid()),
    ola: principalId.parse(ulid()),
    vera: principalId.parse(ulid()),
    bjorn: principalId.parse(ulid()),
    rutger: principalId.parse(ulid()),
    newcomer: principalId.parse(ulid()),
    ninaId: '',
    olaId: '',
    veraId: '',
    bjornId: '',
    squatId: '',
    benchId: '',
    plankId: '',
    nordicId: '',
    templateId: '',
  };

  await provisionGym(host, {
    tenantId: world.t1,
    scopeId: world.s1,
    owner: world.astrid,
    slug: 'nordkraft',
    name: 'Nordkraft Träning & Rehab',
  });
  await provisionGym(host, {
    tenantId: world.t2,
    scopeId: world.s2,
    owner: world.rutger,
    slug: 'sydpuls',
    name: 'Sydpuls Gym',
  });

  // Seed entities go through the OPERATIONS (never raw SQL): the seed exercises
  // the same permission checks and event spine the running app does.
  const astrid = await host.getScope(world.astrid, world.t1, world.s1);

  const ninaCoach = await astrid.invoke<{ id: string }>('stride/create-coach', {
    principalId: world.nina,
    name: 'Nina Ljung',
  });
  const olaCoach = await astrid.invoke<{ id: string }>('stride/create-coach', {
    principalId: world.ola,
    name: 'Ola Sandgren',
  });
  world.ninaId = ninaCoach.id;
  world.olaId = olaCoach.id;

  // Coaches: the role, then the entity-narrowed grants on their OWN coach
  // record. That one grant is what reaches their trainees, programs, sessions
  // and sets through the parent walk — and reaches nothing of the other's.
  for (const [principal, coachId] of [
    [world.nina, world.ninaId],
    [world.ola, world.olaId],
  ] as const) {
    await host.admin.assignRole(staff, {
      principalId: principal,
      roleKey: 'coach',
      node: { tenantId: world.t1, scopeId: world.s1 },
    });
    for (const permission of coachEntityPerms) {
      await host.admin.grant(staff, {
        principalId: principal,
        permission,
        node: { tenantId: world.t1, scopeId: world.s1 },
        entity: { entityType: 'coach', entityId: coachId },
        grantedBy: world.astrid,
      });
    }
  }

  const veraT = await astrid.invoke<{ id: string }>('stride/create-trainee', {
    number: '1001',
    name: 'Vera Holm',
    contact: 'vera@example.test',
    coachId: world.ninaId,
    principalId: world.vera,
  });
  // Björn has no coach on purpose: he is the self-serve case, proving that the
  // app works for someone who never had an exercise prescribed to them.
  const bjornT = await astrid.invoke<{ id: string }>('stride/create-trainee', {
    number: '1002',
    name: 'Björn Ek',
    coachId: world.olaId,
    principalId: world.bjorn,
  });
  world.veraId = veraT.id;
  world.bjornId = bjornT.id;

  for (const [principal, traineeId] of [
    [world.vera, world.veraId],
    [world.bjorn, world.bjornId],
  ] as const) {
    await host.admin.assignRole(staff, {
      principalId: principal,
      roleKey: 'trainee',
      node: { tenantId: world.t1, scopeId: world.s1 },
    });
    for (const permission of traineeEntityPerms) {
      await host.admin.grant(staff, {
        principalId: principal,
        permission,
        node: { tenantId: world.t1, scopeId: world.s1 },
        entity: { entityType: 'trainee', entityId: traineeId },
        grantedBy: world.astrid,
      });
    }
  }

  // THE SHARED LIBRARY — one call, the same one a deployed gym makes.
  //
  // This used to publish 31 pieces of equipment, 62 exercises and two templates
  // by hand, right here in the harness — which is exactly why the first deployed
  // instance came up empty: the only thing that knew what a gym starts with was
  // a file the worker cannot import. `stride/install-starter-library` is that
  // knowledge as an operation, so production gets it and the scenario exercises
  // it on every run.
  await astrid.invoke('stride/install-starter-library');

  const library = await astrid.invoke<{ id: string; slug: string }[]>('stride/exercises');
  const exerciseIds = new Map(library.map((e) => [e.slug, e.id] as const));
  world.squatId = exerciseIds.get('back-squat')!;
  world.benchId = exerciseIds.get('bench-press')!;
  world.plankId = exerciseIds.get('plank')!;

  const installed = await astrid.invoke<{ id: string; name: string }[]>('stride/templates');
  world.templateId = installed.find((t) => t.name === 'Foundation Strength')!.id;

  // Nina's OWN exercise. Ola must never see it; Vera will earn it by doing it.
  const nina = await host.getScope(world.nina, world.t1, world.s1);
  const nordic = await nina.invoke<{ id: string }>('stride/author-exercise', {
    slug: 'nordic-hamstring',
    name: 'Nordic hamstring curl',
    modality: 'rehab',
    unit: 'reps',
    description: "Nina's ACL return-to-play staple.",
    equipment: ['mat'],
  });
  world.nordicId = nordic.id;

  // ---------------------------------------------------------------------------
  // WHO HAS WHAT. `stride/set-my-equipment` takes no id for whose account —
  // it always writes the caller's — so the seed switches persona for each one,
  // exactly as the real app does.
  //
  // The point of the spread: Nina and Ola work in a fully equipped gym, Vera
  // trains at home with almost nothing, and Björn has a corner of a garage. The
  // same catalogue reads very differently for each of them.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // WHO SHARES WHAT. Nothing about being "assigned" to a coach grants anything —
  // the trainee decides, and the decision is real kernel grants. Vera starts on
  // the default floor; Björn shares everything with Ola, so the two shapes are
  // both in the seeded world.
  // ---------------------------------------------------------------------------
  const veraScope = await host.getScope(world.vera, world.t1, world.s1);
  await veraScope.invoke('stride/set-sharing', { coachId: world.ninaId, mode: 'assigned' });
  const bjornScope = await host.getScope(world.bjorn, world.t1, world.s1);
  await bjornScope.invoke('stride/set-sharing', { coachId: world.olaId, mode: 'all' });

  // A first message each way, so the inbox opens on a conversation rather than
  // an empty state.
  await veraScope.invoke('stride/post-message', {
    traineeId: world.veraId,
    coachId: world.ninaId,
    body: 'Knee felt stable through the whole block — should I add load next week?',
  });
  await nina.invoke('stride/post-message', {
    traineeId: world.veraId,
    coachId: world.ninaId,
    body: "Yes — go up 2.5 kg on the nordics, and stop the set if you feel it at all.",
  });

  // A booked training, so the app opens on something real: Vera trains
  // Wednesdays at 11 and Saturdays at 09.
  const veraProgram = await veraScope.invoke<{ program: { id: string } }>(
    'stride/assign-program',
    { title: 'Foundation — block 1', kind: 'strength', templateId: world.templateId },
  );
  await veraScope.invoke('workorder/start', { orderId: veraProgram.program.id });
  await veraScope.invoke('stride/set-program-slots', {
    programId: veraProgram.program.id,
    slots: [
      { weekday: 3, time: '11:00' },
      { weekday: 6, time: '09:00' },
    ],
  });

  // Vera's FIRST BASELINE — done, so the app opens on a curve with a point on
  // it and a left/right gap to close. The left arm is the operated one.
  const baselineTemplate = installed.find((t) => t.name.startsWith('Baseline'))!;
  const baseline = await veraScope.invoke<{ program: { id: string } }>('stride/assign-program', {
    title: 'Baseline #1',
    kind: 'assessment',
    templateId: baselineTemplate.id,
  });
  await veraScope.invoke('workorder/start', { orderId: baseline.program.id });
  const baselineDetail = await veraScope.invoke<{
    items: { id: string; exercise: { slug: string; laterality: string } | null }[];
  }>('stride/get-program', { programId: baseline.program.id });
  const baselineSession = await veraScope.invoke<{ id: string }>('stride/log-session', {
    programId: baseline.program.id,
    performedAt: '2026-09-04T09:00:00.000Z',
    note: 'First baseline — three weeks after the shoulder operation.',
  });
  const baselineResults: Record<string, { left?: [number, string?]; right?: [number, string?]; both?: [number, string?] }> = {
    'assisted-arm-raise': { left: [8], right: [10] },
    'band-external-rotation': { left: [10], right: [15] },
    'single-arm-lateral-raise': { left: [6, '2'], right: [12, '2'] },
    'dumbbell-squat': { both: [14, '10'] },
    'dumbbell-romanian-deadlift': { both: [12, '10'] },
    'single-leg-glute-bridge': { left: [12], right: [14] },
    'single-leg-calf-raise': { left: [16], right: [18] },
    'push-up': { both: [7] },
    'single-arm-dumbbell-press': { left: [6, '4'], right: [12, '4'] },
    'dumbbell-row': { left: [9, '8'], right: [13, '8'] },
    'band-pull-apart': { both: [18] },
    'single-arm-biceps-curl': { left: [9, '4'], right: [14, '4'] },
    plank: { both: [42] },
    'side-plank': { left: [18], right: [30] },
    'single-leg-balance': { left: [30], right: [30] },
    'run-outdoor': { both: [1000] },
  };
  for (const item of baselineDetail.items) {
    const result = baselineResults[item.exercise?.slug ?? ''];
    if (!result) continue;
    for (const side of ['left', 'right', 'both'] as const) {
      const got = result[side];
      if (!got) continue;
      await veraScope.invoke('stride/log-set', {
        sessionId: baselineSession.id,
        programItemId: item.id,
        reps: got[0],
        ...(got[1] ? { load: got[1] } : {}),
        ...(side !== 'both' ? { side } : {}),
        ...(item.exercise?.slug === 'run-outdoor' ? { durationSeconds: 420, avgHr: 158 } : {}),
      });
    }
  }
  await veraScope.invoke('stride/complete-program', { programId: baseline.program.id });

  // And the body: weight, and how far each shoulder goes. The left is the story.
  for (const [kind, side, value, on] of [
    ['weight', null, '72.4', '2026-08-14'],
    ['weight', null, '71.8', '2026-09-04'],
    ['shoulder-flexion', 'left', '95', '2026-08-14'],
    ['shoulder-flexion', 'right', '170', '2026-08-14'],
    ['shoulder-flexion', 'left', '110', '2026-09-04'],
    ['shoulder-flexion', 'right', '172', '2026-09-04'],
  ] as const) {
    await veraScope.invoke('stride/log-measurement', {
      traineeId: world.veraId,
      kind,
      ...(side ? { side } : {}),
      value,
      measuredAt: `${on}T07:00:00.000Z`,
    });
  }

  // Onboarding answers. Björn deliberately has none — so the app has to handle
  // someone who has not answered yet, which is most people on day one.
  await veraScope.invoke('stride/onboard', { goal: 'rehab', daysPerWeek: 5 });

  // Everything the gym owns — read back from the installed vocabulary rather
  // than from the array, so a coach's kit is whatever this gym actually has.
  const fullGym = (
    await astrid.invoke<{ slug: string }[]>('stride/equipment')
  ).map((e) => e.slug);
  const kit: [PrincipalId, string[]][] = [
    [world.nina, fullGym],
    [world.ola, fullGym],
    [world.vera, ['mat', 'resistance-band', 'dumbbells']],
    [world.bjorn, ['kettlebell', 'pull-up-bar', 'mat', 'jump-rope']],
  ];
  for (const [principal, equipment] of kit) {
    const who = await host.getScope(principal, world.t1, world.s1);
    await who.invoke('stride/set-my-equipment', { equipment });
  }

  writeFileSync(castPath, JSON.stringify(world, null, 2));
  return world;
}


// ============================================================================
// THE IDENTITY DIRECTORY — how a verified login becomes a principal.
//
// Harness, and the local stand-in for what the platform delivers with
// provisioning. `src/server.ts` calls this after `seedStride` on EVERY boot,
// not just a fresh one: `linkIdentity` is idempotent when it re-binds the same
// principal (and throws loudly when a subject is already bound to someone
// else), so an existing `.data` dir from before the dev issuer picks up its
// links instead of failing to sign anyone in.
//
// Note where Rutger goes. He is linked into t2 — his OWN gym — because that is
// the only honest answer: a login resolves to the tenant it belongs to, and
// there is no cross-tenant API for him to point at Nordkraft. The old harness
// forced every persona into t1 so he could be turned away in the UI; the
// isolation he demonstrated is proved against the kernel in tests 4 and 14,
// which call the operations directly and are unaffected by any of this.
// ============================================================================

/** Bind every dev persona's `sub` to its principal. Idempotent. */
export async function linkDevIdentities(
  host: SqliteScopeHost,
  world: StrideWorld,
): Promise<void> {
  const staff = platformActorId.parse(ulid());

  // A pool must be registered before it may link: an unregistered pool has not
  // said whether the same subject in two tenants is one human or two, and the
  // kernel will not guess. Central — one issuer, both gyms, one Rutger.
  await host.admin.registerIdentityPool(staff, {
    provider: DEV_PROVIDER,
    topology: 'central',
    tenantId: null,
  });

  const links: [string, PrincipalId, TenantId, ScopeId][] = [
    [SUB.astrid, world.astrid, world.t1, world.s1],
    [SUB.nina, world.nina, world.t1, world.s1],
    [SUB.ola, world.ola, world.t1, world.s1],
    [SUB.vera, world.vera, world.t1, world.s1],
    [SUB.bjorn, world.bjorn, world.t1, world.s1],
    [SUB.rutger, world.rutger, world.t2, world.s2],
    [SUB.newcomer, world.newcomer, world.t1, world.s1],
  ];

  for (const [externalId, principal, tenant, scope] of links) {
    await host.admin.linkIdentity(staff, {
      provider: DEV_PROVIDER,
      externalId,
      principal,
      tenantId: tenant,
      scopeId: scope,
    });
  }
}
