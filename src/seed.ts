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
import { EQUIPMENT, EXERCISES } from './catalogue.js';
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

  // The shared library — admin's job, and the default a new gym starts with.
  // The equipment vocabulary comes first: an exercise cannot be tagged with a
  // piece of kit nobody has defined.
  for (const equipment of EQUIPMENT) {
    await astrid.invoke('stride/publish-equipment', equipment);
  }
  const exerciseIds = new Map<string, string>();
  for (const exercise of EXERCISES) {
    const row = await astrid.invoke<{ id: string }>('stride/publish-exercise', exercise);
    exerciseIds.set(exercise.slug, row.id);
  }
  world.squatId = exerciseIds.get('back-squat')!;
  world.benchId = exerciseIds.get('bench-press')!;
  world.plankId = exerciseIds.get('plank')!;

  const template = await astrid.invoke<{ id: string }>('stride/publish-template', {
    name: 'Foundation Strength',
    description: 'The gym-wide starting program: squat, bench, plank.',
  });
  world.templateId = template.id;
  // Mon / Wed / Fri — a lifting program names its days.
  await astrid.invoke('stride/add-template-item', {
    templateId: world.templateId,
    exerciseId: world.squatId,
    targetSets: 3,
    targetReps: 5,
    targetLoad: '60',
    recurDays: '1,3,5',
  });
  await astrid.invoke('stride/add-template-item', {
    templateId: world.templateId,
    exerciseId: world.benchId,
    targetSets: 3,
    targetReps: 8,
    targetLoad: '40',
    recurDays: '1,3,5',
  });

  // A second shared template, showing the two shapes the prescription can take:
  // a SUPERSET (items sharing a group key, done back to back) and a RAMP (sets
  // that differ from one another, so the item carries an explicit set list).
  const push = await astrid.invoke<{ id: string }>('stride/publish-template', {
    name: 'Upper Push — ramp & superset',
    description: 'A ramping bench, then a shoulder/row superset.',
  });
  const ramp = await astrid.invoke<{ id: string }>('stride/add-template-item', {
    templateId: push.id,
    exerciseId: world.benchId,
    targetSets: 3,
    targetReps: 10,
    recurDays: '2,5',
  });
  // 10 @ 40, 8 @ 45, 6 @ 50, 4 @ 55 — the sets differ, so they are listed.
  await astrid.invoke('stride/set-item-sets', {
    itemId: ramp.id,
    sets: [
      { reps: 10, load: '40', note: 'warm-up' },
      { reps: 8, load: '45' },
      { reps: 6, load: '50' },
      { reps: 4, load: '55', note: 'top set' },
    ],
  });
  // A1 / A2: press then row, back to back.
  for (const [slug, reps, load] of [
    ['dumbbell-shoulder-press', 10, '14'],
    ['dumbbell-row', 10, '20'],
  ] as const) {
    await astrid.invoke('stride/add-template-item', {
      templateId: push.id,
      exerciseId: exerciseIds.get(slug)!,
      targetSets: 3,
      targetReps: reps,
      targetLoad: load,
      groupKey: 'A',
      recurDays: '2,5',
    });
  }

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

  // Onboarding answers. Björn deliberately has none — so the app has to handle
  // someone who has not answered yet, which is most people on day one.
  await veraScope.invoke('stride/onboard', { goal: 'rehab', daysPerWeek: 5 });

  const fullGym = EQUIPMENT.map((e) => e.slug);
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
