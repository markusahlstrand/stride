import { z } from '@substrat-run/contracts';
import { startWorkOrderInput } from '@substrat-run/engine-workorder';
import {
  acceptInput,
  assignProgramInput,
  assignToCoachInput,
  beginInput,
  completeProgramInput,
  createCoachInput,
  createTraineeInput,
  describeExerciseInput,
  equipmentInput,
  exerciseEquipmentInput,
  exerciseInput,
  inviteInput,
  itemSetsInput,
  logMeasurementInput,
  logSessionInput,
  logSetInput,
  myEquipmentInput,
  onboardInput,
  postMessageInput,
  programDetailInput,
  programItemInput,
  removeProgramItemInput,
  removeTemplateItemInput,
  retireExerciseInput,
  revokeInviteInput,
  setSharingInput,
  shareTemplateInput,
  slotsInput,
  strideModule,
  templateInput,
  templateItemInput,
  threadInput,
  timelineInput,
  traineeIdInput,
  trainMyselfInput,
  voidSetInput,
} from './module.js';

// ============================================================================
// THE HTTP MODEL — every endpoint this vertical has, DECLARED.
//
// Nothing here builds a route. `mountOperations` (from @substrat-run/vertical-host)
// reads these declarations and derives the table: it sorts by path specificity,
// refuses two operations that would dispatch identically, merges path params,
// query and body into the operation's input, and maps a thrown
// `PermissionDenied` to a 403 rather than a 500.
//
// Why this file exists at all: the routes used to be hand-written Hono handlers,
// once in the dev harness and again as an RPC endpoint in the worker — the same
// fact described twice, in two shapes, which is why the deployed vertical could
// not serve the web app. A declaration has one reading and one mount.
//
// `{var}` names an INPUT FIELD of the operation, not a free variable: the value
// at that path segment is handed to the operation under that name.
// ============================================================================

/**
 * Reads that carry a query string need their shape declared, or it is dropped.
 *
 * The same applies to WRITES: `mountOperations` invokes with no argument at all
 * when an operation has no path params and no declared `input`, and that check
 * runs after the body is merged — so a POST to a path with no `{param}` silently
 * loses its body. Every such operation below therefore declares the very schema
 * it parses, imported from `module.ts` so the two cannot drift.
 */
const onDate = z.object({ on: z.string().optional() });

/**
 * Every declaration carries a `summary`, and it is not decoration.
 *
 * It is the sentence an MCP client shows the model when it decides which tool to
 * reach for (`mcpToolsOf` falls back to the operation NAME without one, so all 54
 * tools read `stride/agenda` and an agent has to guess). It is also what an API
 * document renders, so the one sentence pays twice.
 *
 * Written for SELECTION rather than for reference: "when would I reach for this",
 * in gym vocabulary, naming the thing that would otherwise be guessed wrong — that
 * creating a workout does not start it, that a set is taken back and never deleted,
 * that publishing is admin-only.
 *
 * Nothing here declares `mcp: false`. That opt-out is for operations a harness
 * calls on its own behalf — a connector posting back, a recording endpoint — and
 * stride has none: every operation below is an act a person performs, so every one
 * is honest as a tool. Curation by CONSUMER is a different question and does not
 * belong in a model.
 */
export const operations = {
  // --- people --------------------------------------------------------------
  'stride/coaches': {
    summary: 'List the coaches in this gym.',
    http: { method: 'GET', path: '/coaches' },
  },
  'stride/create-coach': {
    summary: 'Add a coach to this gym. Admin only.',
    http: { method: 'POST', path: '/coaches' },
    input: createCoachInput,
  },
  'stride/trainees': {
    summary:
      'List the people who train here — everyone for an admin, your own roster as a coach.',
    http: { method: 'GET', path: '/trainees' },
  },
  'stride/create-trainee': {
    summary: 'Enrol somebody as a trainee in this gym.',
    http: { method: 'POST', path: '/trainees' },
    input: createTraineeInput,
  },
  'stride/assign-to-coach': {
    summary: 'Put a trainee on a coach’s roster. Admin only.',
    http: { method: 'POST', path: '/trainees/{traineeId}/coach' },
    input: assignToCoachInput,
  },
  'stride/me': {
    summary: 'Your own trainee record, or nothing if you are not enrolled as one.',
    http: { method: 'GET', path: '/me/trainee' },
  },
  /**
   * Enrol yourself as a trainee. The same path as the GET above and deliberately
   * so — one URL for "my trainee record", read with GET and brought into being
   * with POST. Different methods dispatch differently, so this is not the
   * collision `mountOperations` refuses.
   */
  'stride/train-myself': {
    summary:
      'Enrol yourself as a trainee, for staff who also train here. Idempotent, and grants nothing new.',
    http: { method: 'POST', path: '/me/trainee' },
    input: trainMyselfInput,
  },
  /** Who the caller is, in gym vocabulary — the deployed app's first call. */
  'stride/whoami': {
    summary:
      'Who the caller is here: their role, their name, and their trainee id if they have one. Start here.',
    http: { method: 'GET', path: '/whoami' },
  },
  'stride/onboard': {
    summary: 'Set your training goal and how many days a week you mean to train.',
    http: { method: 'POST', path: '/me/onboard' },
    input: onboardInput,
  },

  // --- invitations ---------------------------------------------------------
  'stride/invitations': {
    summary: 'List the invitations to this gym that are still outstanding.',
    http: { method: 'GET', path: '/invitations' },
  },
  'stride/invite': {
    summary: 'Invite somebody to join this gym as a coach or a trainee.',
    http: { method: 'POST', path: '/invitations' },
    input: inviteInput,
  },
  'stride/revoke-invite': {
    summary: 'Withdraw an invitation that has not been accepted yet.',
    http: { method: 'POST', path: '/invitations/{invitationId}/revoke' },
    input: revokeInviteInput,
  },
  'stride/accept-invite': {
    summary: 'Accept an invitation and take your seat in the gym.',
    http: { method: 'POST', path: '/invitations/{invitationId}/accept' },
    input: acceptInput,
  },

  // --- the conversation ----------------------------------------------------
  'stride/threads': {
    summary: 'Your conversations, each with the number of messages you have not read.',
    http: { method: 'GET', path: '/threads' },
  },
  'stride/messages': {
    summary:
      'Read the conversation between one trainee and one coach. Two people have exactly one.',
    http: { method: 'GET', path: '/threads/{traineeId}/{coachId}' },
    input: threadInput,
  },
  'stride/post-message': {
    summary: 'Send a message in the conversation between a trainee and a coach.',
    http: { method: 'POST', path: '/threads/{traineeId}/{coachId}' },
    input: postMessageInput,
  },

  // --- sharing -------------------------------------------------------------
  'stride/my-sharing': {
    summary: 'How much of your training each of your coaches can currently see.',
    http: { method: 'GET', path: '/me/sharing' },
  },
  'stride/set-sharing': {
    summary:
      'Choose what a coach may see of your training: none, assigned, from-now, or all. Always about YOUR OWN training.',
    http: { method: 'POST', path: '/me/sharing' },
    input: setSharingInput,
  },

  // --- equipment -----------------------------------------------------------
  'stride/equipment': {
    summary: 'The kinds of equipment this gym knows about.',
    http: { method: 'GET', path: '/equipment' },
  },
  'stride/publish-equipment': {
    summary: 'Add a kind of equipment to the gym’s vocabulary. Admin only.',
    http: { method: 'POST', path: '/equipment' },
    input: equipmentInput,
  },
  'stride/set-my-equipment': {
    summary:
      'Say what equipment you have. Nothing listed means bodyweight. Always about YOUR OWN kit.',
    http: { method: 'POST', path: '/me/equipment' },
    input: myEquipmentInput,
  },

  // --- the exercise catalogue ----------------------------------------------
  'stride/exercises': {
    summary:
      'Browse the exercise catalogue. Each row says whether your own kit can do it, and what is missing if not.',
    http: { method: 'GET', path: '/exercises' },
  },
  'stride/my-exercises': {
    summary:
      'The exercises that are yours: the ones you wrote, and every one you have ever performed.',
    http: { method: 'GET', path: '/my-exercises' },
  },
  'stride/publish-exercise': {
    summary: 'Publish an exercise to the gym’s shared library, for everyone. Admin only.',
    http: { method: 'POST', path: '/exercises/publish' },
    input: exerciseInput,
  },
  'stride/author-exercise': {
    summary:
      'Write an exercise of your own, private to you. Coaches and trainees alike may do this.',
    http: { method: 'POST', path: '/exercises/author' },
    input: exerciseInput,
  },
  'stride/set-exercise-equipment': {
    summary: 'Say which equipment an exercise needs.',
    http: { method: 'POST', path: '/exercises/{exerciseId}/equipment' },
    input: exerciseEquipmentInput,
  },
  'stride/retire-exercise': {
    summary:
      'Take an exercise out of the catalogue. Anybody who has performed it keeps it for ever.',
    http: { method: 'POST', path: '/exercises/{exerciseId}/retire' },
    input: retireExerciseInput,
  },
  // `description` rides in the BODY, so the input has to be declared or the
  // mount invokes with no argument at all and the body is silently dropped.
  'stride/describe-exercise': {
    summary:
      'Write an exercise’s description: a one-line summary, the how-to, what to watch for, and what counts as load.',
    http: { method: 'POST', path: '/exercises/{exerciseId}/describe' },
    input: describeExerciseInput,
  },

  // --- templates -----------------------------------------------------------
  'stride/templates': {
    summary: 'The plans you can use: the gym’s shared library plus any you wrote yourself.',
    http: { method: 'GET', path: '/templates' },
  },
  'stride/publish-template': {
    summary: 'Publish a plan to the gym’s shared library, for everyone. Admin only.',
    http: { method: 'POST', path: '/templates/publish' },
    input: templateInput,
  },
  /** The default library a new gym opens with — equipment, exercises, templates. */
  'stride/install-starter-library': {
    summary:
      'Stock a new gym with the default library: equipment, exercises and starter plans. Idempotent — a second run adds only what is missing. Admin only.',
    http: { method: 'POST', path: '/library/install' },
  },
  'stride/author-template': {
    summary: 'Write a plan of your own — a reusable prescription, tied to nobody.',
    http: { method: 'POST', path: '/templates/author' },
    input: templateInput,
  },
  'stride/add-template-item': {
    summary: 'Add an exercise to a plan you own.',
    http: { method: 'POST', path: '/templates/{templateId}/items' },
    input: templateItemInput,
  },
  /** Put a plan you made in front of the whole gym, or take it back. */
  'stride/share-template': {
    summary:
      'Put a plan you wrote in front of the whole gym, or withdraw it again. It stays yours to edit either way.',
    http: { method: 'POST', path: '/templates/{templateId}/share' },
    input: shareTemplateInput,
  },
  // Its own prefix rather than `/items/{itemId}/remove`: that path is a PROGRAMME
  // item, and two operations that dispatch identically are refused at mount.
  'stride/remove-template-item': {
    summary: 'Take an exercise out of a plan you own.',
    http: { method: 'POST', path: '/template-items/{itemId}/remove' },
    input: removeTemplateItemInput,
  },

  // --- programmes ----------------------------------------------------------
  'stride/my-programs': {
    summary: 'The workouts that are yours, or your trainees’ if you coach.',
    http: { method: 'GET', path: '/programs' },
  },
  'stride/assign-program': {
    summary:
      'Create a workout, for yourself or for a trainee you coach, from a plan or from nothing. It is left PLANNED — starting it is a separate call.',
    http: { method: 'POST', path: '/programs' },
    input: assignProgramInput,
  },
  'stride/get-program': {
    summary: 'One workout in full: what it prescribes, when it is trained, and its sessions.',
    http: { method: 'GET', path: '/programs/{programId}' },
    input: programDetailInput,
  },
  'stride/remove-program-item': {
    summary:
      'Drop an exercise from a workout. Only while it is planned or in progress — once finished, the prescription is what adherence was measured against.',
    http: { method: 'POST', path: '/items/{itemId}/remove' },
    input: removeProgramItemInput,
  },
  'stride/add-program-item': {
    summary:
      'Add an exercise to a workout, while it is still planned or in progress. The prescription is a snapshot, never a reference.',
    http: { method: 'POST', path: '/programs/{programId}/items' },
    input: programItemInput,
  },
  'stride/set-program-slots': {
    summary: 'Book which weekdays and times this workout is trained — "Wednesdays at 11".',
    http: { method: 'POST', path: '/programs/{programId}/slots' },
    input: slotsInput,
  },
  'stride/begin': {
    summary:
      'Open today’s session on a workout, or resume the one already open. It does NOT start the workout — use workorder/start first.',
    http: { method: 'POST', path: '/programs/{programId}/begin' },
    input: beginInput,
  },
  'stride/complete-program': {
    summary:
      'Finish a block and compute its adherence, prescribed against performed. Optional: a standing workout is never finished, and that is normal.',
    http: { method: 'POST', path: '/programs/{programId}/complete' },
    input: completeProgramInput,
  },
  'stride/log-session': {
    summary:
      'Record a new session on a workout that is under way. Use stride/begin instead to open or resume today’s.',
    http: { method: 'POST', path: '/programs/{programId}/sessions' },
    input: logSessionInput,
  },
  'stride/log-set': {
    summary:
      'Log one set that was performed. The count is in the exercise’s own unit — reps, seconds or metres — and a unilateral exercise must name a side.',
    http: { method: 'POST', path: '/sessions/{sessionId}/sets' },
    input: logSetInput,
  },
  // Taking a set back is addressed BY THE SET, because that is the thing being
  // taken back — the session it was in is already written on it.
  'stride/void-set': {
    summary:
      'Take back a set logged by mistake. It is voided, never deleted, and the exercise stays earned. Refused once the workout is finished.',
    http: { method: 'POST', path: '/sets/{setId}/void' },
    input: voidSetInput,
  },
  'stride/set-item-sets': {
    summary:
      'Rewrite what one exercise in a workout prescribes, as an explicit list of sets.',
    http: { method: 'POST', path: '/items/{itemId}/sets' },
    input: itemSetsInput,
  },

  // --- the body, and the curve ---------------------------------------------
  // Both by TRAINEE, because that is whose they are. `{traineeId}` is the
  // operation's own input field; the app passes `me.traineeId` for "mine".
  'stride/measurements': {
    summary:
      'A person’s measurements over time: weight, girths, grip, shoulder range. Append-only.',
    http: { method: 'GET', path: '/trainees/{traineeId}/measurements' },
    input: traineeIdInput,
  },
  'stride/log-measurement': {
    summary: 'Record a measurement of a body. A correction is a new row, never an edit.',
    http: { method: 'POST', path: '/trainees/{traineeId}/measurements' },
    input: logMeasurementInput,
  },
  /** Every exercise this person has performed, folded per session and per side. */
  'stride/progress': {
    summary:
      'A person’s training curves: best set, volume and pace per exercise over time, plus left-right symmetry.',
    http: { method: 'GET', path: '/trainees/{traineeId}/progress' },
    input: traineeIdInput,
  },

  // --- reads that carry a query --------------------------------------------
  'stride/agenda': {
    summary:
      'The appointment book: what training is booked for a day, and whether it has happened yet. Defaults to today.',
    http: { method: 'GET', path: '/agenda' },
    input: onDate,
  },
  'stride/schedule': {
    summary:
      'What is due to be trained this week, exercise by exercise, across every workout you can see.',
    http: { method: 'GET', path: '/schedule' },
    input: onDate,
  },

  // --- the audit spine -----------------------------------------------------
  // Both of the operation's input fields come off the path, because a timeline is
  // asked for by entity and there is no other shape that reads as a URL.
  'stride/timeline': {
    summary:
      'Everything that has happened to one entity, in order, with who did it and when. The audit spine.',
    http: { method: 'GET', path: '/timeline/{entityType}/{entityId}' },
    input: timelineInput,
  },

  // --- a composed engine's operation ---------------------------------------
  // An ENGINE declares no `http` and should not: it is entity-agnostic and does
  // not own a URL shape. The vertical decides what a work order is called here —
  // it is a programme — and binds the name itself. `orderId` is the engine's
  // input field, so that is what the path segment must be called.
  'workorder/start': {
    summary:
      'Start a planned workout, moving it to in progress. The separate, deliberate call that carries the permission guard — then use stride/begin to open a session.',
    http: { method: 'POST', path: '/programs/{orderId}/start' },
    input: startWorkOrderInput,
  },
} as const;

/**
 * Every operation the host actually registers. Given this, a binding above that
 * names an operation nobody provides fails AT MOUNT with a message naming it,
 * instead of as a 404 the first time somebody calls that endpoint.
 */
export const knownOperations: string[] = [
  ...Object.keys(strideModule.operations ?? {}),
  'workorder/start',
  'workorder/assign',
  'workorder/report-time',
  'workorder/report-material',
  'workorder/complete',
  'workorder/close',
  'workorder/get',
  'workorder/list',
];
