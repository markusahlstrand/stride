// ============================================================================
// Typed wrappers over the thin HTTP API. The `x-principal` header is the DEV
// PRINCIPAL PICKER — a seam, not a login. Everything it can reach, it can reach
// because the kernel granted it; switching personas here proves the permission
// model rather than hiding it.
// ============================================================================

/**
 * THE DEV SEAM, and the one thing that must not ship. `import.meta.env.DEV` is
 * true only under `vite dev`; the built bundle — the one the platform uploads —
 * has it constant-folded to false, so the `x-principal` header below is not just
 * unused in production, it is not in the file. A deployed app that could still
 * name its own principal would be a cross-tenant hole with a UI.
 */
export const DEV: boolean = import.meta.env.DEV;

/** What the worker knows before any operation runs — see `/api/session`. */
export interface AuthSession {
  signedIn: boolean;
  /** A verified login that maps to a principal in THIS gym. */
  seated: boolean;
  /** The owner seat is unclaimed: the first person to sign in becomes the admin. */
  needsSetup: boolean;
  principal: string | null;
  email: string | null;
  name: string | null;
}

/** Who the caller is in gym vocabulary — the deployed counterpart of the cast. */
export interface WhoAmI {
  principal: string;
  role: 'admin' | 'coach' | 'trainee';
  name: string | null;
  recordId: string | null;
}

export interface CastMember {
  key: string;
  name: string;
  role: 'admin' | 'coach' | 'trainee' | 'outsider';
  subjectId: string | null;
}

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  modality: string;
  unit: string;
  description: string | null;
  visibility: 'shared' | 'private';
  owner_coach_id: string | null;
  owner_trainee_id: string | null;
  active: number;
  access?: 'shared' | 'granted';
  equipment: string[];
  /** Do you have everything it needs? Advice, never a permission. */
  canDo: boolean;
  missing: string[];
}

export interface Trainee {
  id: string;
  number: string;
  name: string;
  contact: string | null;
  coach_id: string | null;
  goal: Goal | null;
  days_per_week: number | null;
}

export interface Coach {
  id: string;
  principal_id: string;
  name: string;
}

export interface ItemSet {
  id: string;
  set_no: number;
  target_reps: number;
  target_load: string | null;
  note: string | null;
}

export interface Item {
  id: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  target_reps: number;
  target_load: string | null;
  notes: string | null;
  recur_days: string | null;
  recur_per_week: number | null;
  /** Same key = a superset, performed back to back. */
  group_key: string | null;
}

export type Goal = 'strength' | 'muscle' | 'endurance' | 'rehab' | 'general';

export interface Me {
  id: string;
  name: string;
  number: string;
  goal: Goal | null;
  days_per_week: number | null;
  onboarded_at: string | null;
}

export type SharingMode = 'none' | 'assigned' | 'from-now' | 'all';

export interface Sharing {
  trainee_id: string;
  coach_id: string;
  coachName: string;
  mode: SharingMode;
  since: string | null;
  updated_at: string;
}

export interface Invitation {
  id: string;
  role_key: string;
  state: 'invited' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
}

export interface Equipment {
  slug: string;
  name: string;
  category: string;
  available: boolean;
}

export interface Message {
  id: string;
  trainee_id: string;
  coach_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface Thread {
  traineeId: string;
  traineeName: string;
  coachId: string;
  coachName: string;
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
}

export interface Slot {
  id: string;
  program_id: string;
  weekday: number;
  time_of_day: string;
}

export interface AgendaEntry {
  programId: string;
  programTitle: string;
  traineeName: string | null;
  status: string;
  weekday: number;
  time: string;
  dueToday: boolean;
  sessionToday: string | null;
  setsToday: number;
  exercises: number;
}

export interface ScheduledItem {
  programId: string;
  programTitle: string;
  itemId: string;
  exerciseId: string;
  exerciseName: string;
  unit: string;
  targetSets: number;
  targetReps: number;
  targetLoad: string | null;
  recurDays: string | null;
  recurPerWeek: number | null;
  dueToday: boolean;
  doneThisWeek: number;
  targetThisWeek: number;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  visibility: 'shared' | 'private';
  items: Item[];
}

export interface SetResult {
  id: string;
  session_id: string;
  program_item_id: string;
  exercise_id: string;
  set_no: number;
  /** The quantity in the exercise's own unit — reps, seconds or metres. */
  reps: number;
  load: string | null;
  rpe: string | null;
  duration_seconds: number | null;
  avg_hr: number | null;
}

export interface Session {
  id: string;
  program_id: string;
  performed_at: string;
  note: string | null;
  sets: SetResult[];
}

export interface ProgramCard {
  id: string;
  number: number;
  title: string;
  kind: string;
  status: 'planned' | 'in_progress' | 'completed' | 'closed';
  traineeName: string | null;
  setsLogged: number;
}

export interface Summary {
  prescribed_sets: number;
  performed_sets: number;
  total_reps: number;
  total_volume: string;
  total_seconds: number;
  adherence_pct: string;
}

export interface ProgramDetail {
  program: ProgramCard;
  items: (Item & { exercise: Exercise | null; sets: ItemSet[] })[];
  slots: Slot[];
  sessions: Session[];
  summary: Summary | null;
}

/** A denial from the kernel, kept distinct so the UI can celebrate it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  get denied() {
    return this.status === 403;
  }
}

// The URL wins, so a link carries who you are pretending to be and a refresh
// keeps it. localStorage is only the fallback for a bare visit.
let principal =
  new URLSearchParams(window.location.search).get('as') ??
  localStorage.getItem('principal') ??
  'nina';

export const currentPrincipal = () => principal;
export function setPrincipal(key: string) {
  principal = key;
  localStorage.setItem('principal', key);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // Dev only, and absent from the production bundle entirely: in a deployed
      // instance the session cookie says who you are and the app never claims it.
      ...(DEV ? { 'x-principal': principal } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? res.statusText, res.status);
  return data as T;
}

const get = <T,>(path: string) => call<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  /** Signed in? Seated? Unclaimed gym? Answers while signed out, never 403s. */
  session: () => get<AuthSession>('/session'),
  /** Who I am in this gym — an operation, so the kernel decides whether to answer. */
  whoami: () => get<WhoAmI>('/whoami'),
  cast: () => get<CastMember[]>('/cast'),
  me: () => get<CastMember>('/me'),

  meTrainee: () => get<Me | null>('/me/trainee'),
  onboard: (goal: Goal, daysPerWeek: number) => post<Me>('/me/onboard', { goal, daysPerWeek }),
  setItemSets: (itemId: string, sets: { reps: number; load?: string; note?: string }[]) =>
    post<unknown>(`/items/${itemId}/sets`, { sets }),

  threads: () => get<Thread[]>('/threads'),
  messages: (traineeId: string, coachId: string) =>
    get<{ messages: Message[]; me: string }>(`/threads/${traineeId}/${coachId}`),
  postMessage: (traineeId: string, coachId: string, body: string) =>
    post<Message>(`/threads/${traineeId}/${coachId}`, { body }),

  mySharing: () => get<Sharing[]>('/me/sharing'),
  setSharing: (coachId: string, mode: SharingMode) =>
    post<Sharing>('/me/sharing', { coachId, mode }),
  invitations: () => get<Invitation[]>('/invitations'),
  invite: (identifier: string, as: 'coach' | 'trainee') =>
    post<{ id: string }>('/invitations', { identifier, as }),
  revokeInvitation: (id: string) => post<unknown>(`/invitations/${id}/revoke`),

  equipment: () => get<Equipment[]>('/equipment'),
  setMyEquipment: (equipment: string[]) => post<unknown>('/me/equipment', { equipment }),
  schedule: () => get<ScheduledItem[]>('/schedule'),
  agenda: () => get<AgendaEntry[]>('/agenda'),
  setSlots: (programId: string, slots: { weekday: number; time: string }[]) =>
    post<{ slots: Slot[] }>(`/programs/${programId}/slots`, { slots }),
  begin: (programId: string) =>
    post<{ session: Session; resumed: boolean }>(`/programs/${programId}/begin`),

  exercises: () => get<Exercise[]>('/exercises'),
  myExercises: () => get<Exercise[]>('/my-exercises'),
  publishExercise: (b: unknown) => post<Exercise>('/exercises/publish', b),
  authorExercise: (b: unknown) => post<Exercise>('/exercises/author', b),
  retireExercise: (id: string) => post<Exercise>(`/exercises/${id}/retire`),

  templates: () => get<Template[]>('/templates'),
  publishTemplate: (b: unknown) => post<Template>('/templates/publish', b),
  authorTemplate: (b: unknown) => post<Template>('/templates/author', b),
  addTemplateItem: (id: string, b: unknown) => post<Item>(`/templates/${id}/items`, b),

  coaches: () => get<Coach[]>('/coaches'),
  trainees: () => get<Trainee[]>('/trainees'),
  createTrainee: (b: unknown) => post<Trainee>('/trainees', b),

  programs: () => get<ProgramCard[]>('/programs'),
  program: (id: string) => get<ProgramDetail>(`/programs/${id}`),
  assignProgram: (b: unknown) => post<{ program: ProgramCard }>('/programs', b),

  /**
   * Set up a standing workout in one gesture: create it, book it, start it.
   *
   * Three calls rather than one operation on purpose. `workorder/start` carries
   * the manifest guard, and an in-scope shortcut around it would be the hole the
   * guard exists to close — so the client does what a person would do, with
   * every gate intact, instead of the server quietly doing it for them.
   */
  createRoutine: async (input: {
    title: string;
    kind: string;
    templateId?: string;
    slots: { weekday: number; time: string }[];
  }) => {
    const { program } = await post<{ program: ProgramCard }>('/programs', input);
    await post<unknown>(`/programs/${program.id}/start`);
    return program;
  },
  addProgramItem: (programId: string, b: unknown) => post<Item>(`/programs/${programId}/items`, b),
  startProgram: (id: string) => post<ProgramCard>(`/programs/${id}/start`),
  completeProgram: (id: string) => post<{ summary: Summary }>(`/programs/${id}/complete`),
  // The model declares a timeline as `/timeline/{entityType}/{entityId}` — it is
  // asked for by entity, and a programme is only one kind of entity that has one.
  timeline: (entityType: string, entityId: string) =>
    get<{ type: string; occurred_at: string }[]>(`/timeline/${entityType}/${entityId}`),

  logSession: (programId: string, b: unknown) => post<Session>(`/programs/${programId}/sessions`, b),
  logSet: (sessionId: string, b: unknown) =>
    post<{ set: SetResult; earned: boolean }>(`/sessions/${sessionId}/sets`, b),
};
