import { z } from '@substrat-run/contracts';
import { strideModule } from './module.js';

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

/** Reads that carry a query string need their shape declared, or it is dropped. */
const onDate = z.object({ on: z.string().optional() });

export const operations = {
  // --- people --------------------------------------------------------------
  'stride/coaches': { http: { method: 'GET', path: '/coaches' } },
  'stride/create-coach': { http: { method: 'POST', path: '/coaches' } },
  'stride/trainees': { http: { method: 'GET', path: '/trainees' } },
  'stride/create-trainee': { http: { method: 'POST', path: '/trainees' } },
  'stride/assign-to-coach': {
    http: { method: 'POST', path: '/trainees/{traineeId}/coach' },
  },
  'stride/me': { http: { method: 'GET', path: '/me/trainee' } },
  /** Who the caller is, in gym vocabulary — the deployed app's first call. */
  'stride/whoami': { http: { method: 'GET', path: '/whoami' } },
  'stride/onboard': { http: { method: 'POST', path: '/me/onboard' } },

  // --- invitations ---------------------------------------------------------
  'stride/invitations': { http: { method: 'GET', path: '/invitations' } },
  'stride/invite': { http: { method: 'POST', path: '/invitations' } },
  'stride/revoke-invite': {
    http: { method: 'POST', path: '/invitations/{invitationId}/revoke' },
  },
  'stride/accept-invite': {
    http: { method: 'POST', path: '/invitations/{invitationId}/accept' },
  },

  // --- the conversation ----------------------------------------------------
  'stride/threads': { http: { method: 'GET', path: '/threads' } },
  'stride/messages': {
    http: { method: 'GET', path: '/threads/{traineeId}/{coachId}' },
  },
  'stride/post-message': {
    http: { method: 'POST', path: '/threads/{traineeId}/{coachId}' },
  },

  // --- sharing -------------------------------------------------------------
  'stride/my-sharing': { http: { method: 'GET', path: '/me/sharing' } },
  'stride/set-sharing': { http: { method: 'POST', path: '/me/sharing' } },

  // --- equipment -----------------------------------------------------------
  'stride/equipment': { http: { method: 'GET', path: '/equipment' } },
  'stride/publish-equipment': { http: { method: 'POST', path: '/equipment' } },
  'stride/set-my-equipment': { http: { method: 'POST', path: '/me/equipment' } },

  // --- the exercise catalogue ----------------------------------------------
  'stride/exercises': { http: { method: 'GET', path: '/exercises' } },
  'stride/my-exercises': { http: { method: 'GET', path: '/my-exercises' } },
  'stride/publish-exercise': { http: { method: 'POST', path: '/exercises/publish' } },
  'stride/author-exercise': { http: { method: 'POST', path: '/exercises/author' } },
  'stride/set-exercise-equipment': {
    http: { method: 'POST', path: '/exercises/{exerciseId}/equipment' },
  },
  'stride/retire-exercise': {
    http: { method: 'POST', path: '/exercises/{exerciseId}/retire' },
  },

  // --- templates -----------------------------------------------------------
  'stride/templates': { http: { method: 'GET', path: '/templates' } },
  'stride/publish-template': { http: { method: 'POST', path: '/templates/publish' } },
  'stride/author-template': { http: { method: 'POST', path: '/templates/author' } },
  'stride/add-template-item': {
    http: { method: 'POST', path: '/templates/{templateId}/items' },
  },

  // --- programmes ----------------------------------------------------------
  'stride/my-programs': { http: { method: 'GET', path: '/programs' } },
  'stride/assign-program': { http: { method: 'POST', path: '/programs' } },
  'stride/get-program': { http: { method: 'GET', path: '/programs/{programId}' } },
  'stride/add-program-item': {
    http: { method: 'POST', path: '/programs/{programId}/items' },
  },
  'stride/set-program-slots': {
    http: { method: 'POST', path: '/programs/{programId}/slots' },
  },
  'stride/begin': { http: { method: 'POST', path: '/programs/{programId}/begin' } },
  'stride/complete-program': {
    http: { method: 'POST', path: '/programs/{programId}/complete' },
  },
  'stride/log-session': {
    http: { method: 'POST', path: '/programs/{programId}/sessions' },
  },
  'stride/log-set': { http: { method: 'POST', path: '/sessions/{sessionId}/sets' } },
  'stride/set-item-sets': { http: { method: 'POST', path: '/items/{itemId}/sets' } },

  // --- reads that carry a query --------------------------------------------
  'stride/agenda': { http: { method: 'GET', path: '/agenda' }, input: onDate },
  'stride/schedule': { http: { method: 'GET', path: '/schedule' }, input: onDate },

  // --- the audit spine -----------------------------------------------------
  // Both of the operation's input fields come off the path, because a timeline is
  // asked for by entity and there is no other shape that reads as a URL.
  'stride/timeline': {
    http: { method: 'GET', path: '/timeline/{entityType}/{entityId}' },
  },

  // --- a composed engine's operation ---------------------------------------
  // An ENGINE declares no `http` and should not: it is entity-agnostic and does
  // not own a URL shape. The vertical decides what a work order is called here —
  // it is a programme — and binds the name itself. `orderId` is the engine's
  // input field, so that is what the path segment must be called.
  'workorder/start': { http: { method: 'POST', path: '/programs/{orderId}/start' } },
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
