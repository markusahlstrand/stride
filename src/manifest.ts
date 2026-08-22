import { moduleManifest, permissionKey } from '@substrat-run/contracts';

// ============================================================================
// The vertical's MANIFEST — the reviewable contract the kernel reads at
// registration. A training app (gym + physio rehab) composed onto one engine:
//
//   engine-workorder — an ASSIGNED PROGRAM's state machine and append-only spine
//
// This vertical owns the vocabulary (coaches, trainees, exercises, templates,
// the prescription, sessions and set results) and two things worth reading
// twice:
//
//   1. THE EARNED EXERCISE. Perform an exercise once and it is yours forever —
//      expressed as the entity edge `exercise → trainee`, walked by the kernel,
//      not as a WHERE clause. See `logSetOp` in module.ts.
//   2. THE GUARD. A coach is narrowed to their own trainees, but the engine's
//      own lifecycle operations check `workorder:report` at NODE level. The
//      guard below re-checks per program, inside the same transaction, failing
//      closed. Without it "a coach only touches their own trainees" would be
//      true of listings and false of writes.
//
// Read DESIGN.md, then CLAUDE.md / AGENTS.md, before you touch it.
// ============================================================================

/** The vertical's own permission keys (engine-workorder declares its own). */
export const TRAIN_PERM = {
  traineeManage: permissionKey.parse('trainee:manage'),
  libraryPublish: permissionKey.parse('library:publish'),
  libraryAuthor: permissionKey.parse('library:author'),
  exerciseReadShared: permissionKey.parse('exercise:read-shared'),
  exerciseRead: permissionKey.parse('exercise:read'),
  templateReadShared: permissionKey.parse('template:read-shared'),
  templateRead: permissionKey.parse('template:read'),
  equipmentManage: permissionKey.parse('equipment:manage'),
  shareManage: permissionKey.parse('share:manage'),
  messageRead: permissionKey.parse('message:read'),
  messagePost: permissionKey.parse('message:post'),
  resultLog: permissionKey.parse('result:log'),
  resultRead: permissionKey.parse('result:read'),
};

/**
 * The guard predicate's name. Predicate names are GLOBAL across every registered
 * module, so it carries the module prefix like an operation does.
 */
export const PROGRAM_IN_REACH = 'stride/program-in-reach';

/**
 * Every engine operation that mutates a program, each gated a second time by
 * `PROGRAM_IN_REACH`. The engine checks its node-level key; the guard then
 * re-checks `result:log` against the program AS AN ENTITY, so the parent walk
 * (workorder → trainee → coach) decides. An unresolvable predicate BLOCKS the
 * operation — a typo can never widen the gate.
 */
const GUARDED_ENGINE_OPERATIONS = [
  'workorder/assign',
  'workorder/start',
  'workorder/report-time',
  'workorder/report-material',
  'workorder/complete',
  'workorder/close',
];

export const strideManifest = moduleManifest.parse({
  id: 'stride',
  version: '0.0.1',
  kernelContract: '^0.0.1',
  permissions: [
    { key: 'trainee:manage', description: 'Register coaches and trainees, and assign a trainee to a coach' },
    { key: 'library:publish', description: 'Publish exercises and program templates to the whole organisation' },
    { key: 'library:author', description: 'Create your own exercises and program templates' },
    { key: 'exercise:read-shared', description: "Browse the organisation's shared exercise catalogue" },
    { key: 'exercise:read', description: 'Read one specific exercise — one you authored, or one you have earned by performing it' },
    { key: 'template:read-shared', description: 'Browse the shared program templates' },
    { key: 'template:read', description: 'Read one specific program template — one you authored' },
    {
      key: 'equipment:manage',
      description:
        'Record which equipment you have available. Writes only to your own account — the operation takes no id for whose.',
    },
    {
      key: 'share:manage',
      description:
        'Decide which of your training data a coach may see. Writes only your own sharing — the grants it mints are re-checked against what you hold yourself, so it can never hand out more than you have.',
    },
    {
      key: 'message:read',
      description:
        'Read the conversation with a coach. Entity-narrowed to the trainee the conversation is about.',
    },
    {
      key: 'message:post',
      description:
        'Write in that conversation. Held by both sides of a live coaching relationship, and withdrawn when it ends.',
    },
    { key: 'result:log', description: 'Record training sessions and set results, and drive a program through its lifecycle' },
    { key: 'result:read', description: 'Read trainees, their programs and their results' },
  ],
  // The vertical emits its own domain events and consumes none: nothing here
  // listens to anything. Every payload is FAT — a consumer must never need a
  // cross-module read to understand one.
  events: {
    emits: [
      { type: 'stride.coach-registered', schemaVersion: 1 },
      { type: 'stride.trainee-registered', schemaVersion: 1 },
      { type: 'stride.trainee-assigned', schemaVersion: 1 },
      { type: 'stride.exercise-created', schemaVersion: 1 },
      { type: 'stride.exercise-retired', schemaVersion: 1 },
      { type: 'stride.exercise-equipment-set', schemaVersion: 1 },
      { type: 'stride.equipment-published', schemaVersion: 1 },
      { type: 'stride.account-equipment-set', schemaVersion: 1 },
      { type: 'stride.template-created', schemaVersion: 1 },
      { type: 'stride.template-item-added', schemaVersion: 1 },
      { type: 'stride.program-assigned', schemaVersion: 1 },
      { type: 'stride.sharing-changed', schemaVersion: 1 },
      { type: 'stride.message-posted', schemaVersion: 1 },
      { type: 'stride.invited', schemaVersion: 1 },
      { type: 'stride.joined', schemaVersion: 1 },
      { type: 'stride.program-item-added', schemaVersion: 1 },
      { type: 'stride.item-sets-set', schemaVersion: 1 },
      { type: 'stride.slots-set', schemaVersion: 1 },
      { type: 'stride.onboarded', schemaVersion: 1 },
      { type: 'stride.session-logged', schemaVersion: 1 },
      { type: 'stride.set-logged', schemaVersion: 1 },
      { type: 'stride.exercise-earned', schemaVersion: 1 },
      { type: 'stride.program-completed', schemaVersion: 1 },
    ],
    consumes: [],
  },
  migrations: { journalDir: './migrations', compatibleFrom: '0.0.1' },
  attachmentTargets: [
    { entityType: 'exercise', readPermission: 'exercise:read' },
    { entityType: 'trainee', readPermission: 'result:read' },
    { entityType: 'session', readPermission: 'result:read' },
  ],
  // ---------------------------------------------------------------------------
  // EVERY edge the app walks must be declared here or `ctx.link` is rejected.
  //
  //   exercise ─┬─→ coach          authored by a coach
  //             └─→ trainee        authored by a trainee, OR EARNED by
  //                                performing it — deliberately the same edge,
  //                                so "mine" and "what I've done" are one walk
  //   template ─┬─→ coach          authored by
  //             └─→ trainee
  //   workorder ──→ trainee        the program's subject (the ENGINE links this)
  //   session  ───→ workorder      performed under
  //
  // One entity-narrowed grant on `coach:<id>` therefore reaches that coach's
  // trainees, their programs, their sessions and every set in them — and
  // reaches nothing of another coach's. Deepest walk is
  // session → workorder → trainee → coach (3); the evaluator's limit is 4.
  // ---------------------------------------------------------------------------
  entityRelations: [
    { entityType: 'exercise', parentType: 'coach' },
    { entityType: 'exercise', parentType: 'trainee' },
    { entityType: 'template', parentType: 'coach' },
    { entityType: 'template', parentType: 'trainee' },
    { entityType: 'workorder', parentType: 'trainee' },
    // The program a coach assigned belongs to that coach. This edge — per
    // PROGRAM — is what replaced the old trainee -> coach edge, which handed a
    // coach that person's entire history for ever.
    { entityType: 'workorder', parentType: 'coach' },
    { entityType: 'session', parentType: 'workorder' },
  ],
  guards: GUARDED_ENGINE_OPERATIONS.map((before) => ({
    before,
    predicate: PROGRAM_IN_REACH,
    config: {},
  })),
  entitlementKey: 'stride',
});
