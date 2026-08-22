import { definePermissions, type PermissionKey, type RoleDefinition } from '@substrat-run/contracts';
import { workorderModule, PERM as WO } from '@substrat-run/engine-workorder';
import { invitesModule, INVITES_PERM } from '@substrat-run/engine-invites';
import { strideModule } from './module.js';
import { TRAIN_PERM } from './manifest.js';

// ============================================================================
// WHAT THIS VERTICAL IS MADE OF — the module set, the role table, and the shape
// of the entity-narrowed grants.
//
// Its own file because BOTH runtimes need it and they share nothing else: the
// local harness (`seed.ts`, on SQLite) and the deployed worker (`worker.ts`, on
// Durable Objects). It imports engines and this vertical, and NO adapter — the
// moment it reaches for one, the other runtime cannot bundle.
//
// That is not a packaging detail. It is what makes "what runs in production is
// what the scenario tests exercised" true: one array, registered twice.
// ============================================================================

/**
 * The modules this vertical composes, in registration order. Exported so a
 * permission snapshot renders from the same array the running host registers —
 * the artifact can never drift from reality.
 */
export const MODULES = [workorderModule, invitesModule, strideModule];

const adminPerms: PermissionKey[] = [
  TRAIN_PERM.traineeManage,
  TRAIN_PERM.libraryPublish,
  TRAIN_PERM.libraryAuthor,
  TRAIN_PERM.exerciseReadShared,
  TRAIN_PERM.exerciseRead, // NODE level: an admin reads every coach's private exercises
  TRAIN_PERM.templateReadShared,
  TRAIN_PERM.templateRead,
  TRAIN_PERM.equipmentManage,
  TRAIN_PERM.shareManage,
  TRAIN_PERM.messageRead,
  TRAIN_PERM.messagePost,
  INVITES_PERM.send,
  INVITES_PERM.read,
  INVITES_PERM.revoke,
  TRAIN_PERM.resultLog,
  TRAIN_PERM.resultRead,
  WO.create,
  WO.read,
  WO.assign,
  WO.report,
  WO.complete,
  WO.close,
];

/**
 * A coach's ROLE carries only the powers that are the same for every coach.
 * Everything that depends on WHOSE record it is — reading an exercise, reading a
 * trainee, logging a result — is deliberately absent here and arrives as an
 * entity-narrowed grant on their own coach record instead (ENTITY_GRANTS below).
 *
 * The engine's lifecycle keys ARE node-level, because engine-workorder checks
 * them node-level and there is no narrower binding to hold. They are safe only
 * because manifest.ts declares the `stride/program-in-reach` guard in front of
 * every one of those operations. Remove the guard and these five rows become a
 * hole.
 */
export const ROLES: RoleDefinition[] = [
  { key: 'admin', permissions: adminPerms, source: 'vertical' },
  {
    key: 'coach',
    permissions: [
      TRAIN_PERM.libraryAuthor,
      TRAIN_PERM.exerciseReadShared,
      TRAIN_PERM.templateReadShared,
      TRAIN_PERM.equipmentManage,
      INVITES_PERM.send,
      INVITES_PERM.read,
      INVITES_PERM.revoke,
      WO.create,
      WO.assign,
      WO.report,
      WO.complete,
      WO.close,
    ],
    source: 'vertical',
  },
  /**
   * A trainee holds almost nothing that names another person. `library:author`
   * lets them create their OWN exercises and templates; the three engine keys
   * let them run their OWN programs — and every one of those paths is narrowed
   * a second time before it does anything:
   *
   *   workorder:create  → assign-program re-checks `result:log` on the target
   *                       trainee, which for them resolves only to themselves.
   *   workorder:report  → every engine operation using it sits behind the
   *   workorder:complete   `stride/program-in-reach` guard.
   *
   * Take either of those second gates away and this row becomes a hole.
   */
  {
    key: 'trainee',
    permissions: [
      TRAIN_PERM.exerciseReadShared,
      // Shared templates are gym-wide library content, exactly like shared
      // exercises. Without this a self-serve trainee could create a programme
      // but never start from one of the gym's own.
      TRAIN_PERM.templateReadShared,
      TRAIN_PERM.libraryAuthor,
      TRAIN_PERM.equipmentManage,
      TRAIN_PERM.shareManage,
      INVITES_PERM.send,
      INVITES_PERM.read,
      WO.create,
      WO.report,
      WO.complete,
    ],
    source: 'vertical',
  },
];

/** What a coach holds against their OWN coach record. */
export const coachEntityPerms: PermissionKey[] = [
  TRAIN_PERM.exerciseRead,
  TRAIN_PERM.templateRead,
  TRAIN_PERM.resultLog,
  TRAIN_PERM.resultRead,
  WO.read,
];

/** What a trainee holds against their OWN trainee record. */
export const traineeEntityPerms: PermissionKey[] = [
  TRAIN_PERM.exerciseRead,
  TRAIN_PERM.resultLog,
  TRAIN_PERM.resultRead,
  // Their own side of every conversation about them. The coach's side is minted
  // by `set-sharing` and withdrawn when the relationship ends.
  TRAIN_PERM.messageRead,
  TRAIN_PERM.messagePost,
  WO.read,
];

/**
 * Entity-narrowed grant SHAPES. The grants themselves are per-principal and
 * minted at runtime, so they can never be a build artifact; their shape is what
 * tells a reviewer which keys are reachable outside the role table.
 */
export const ENTITY_GRANTS: { entityType: string; permissions: PermissionKey[] }[] = [
  { entityType: 'coach', permissions: coachEntityPerms },
  { entityType: 'trainee', permissions: traineeEntityPerms },
];

/**
 * THE PERMISSION SURFACE, declared once and derived from the same three things
 * the running host registers: the modules, the role table, and the shapes of the
 * entity-narrowed grants.
 *
 * `substrat push` reads this to build what it ships, and the promotion
 * checkpoint renders the diff from the same function — so what a reviewer
 * acknowledges and what the platform enforces cannot disagree. That is the whole
 * point of pointing at code rather than restating the table in a config file.
 */
export const permissions = definePermissions({
  modules: MODULES,
  roles: ROLES,
  entityGrants: ENTITY_GRANTS,
});
