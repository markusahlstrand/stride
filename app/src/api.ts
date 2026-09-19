// ============================================================================
// Typed wrappers over the thin HTTP API.
//
// There is no dev seam here any more. The app never names its own principal in
// either runtime: a session cookie says who you are, and `/api/session` is how
// the shell finds out. Locally that cookie comes from the dev issuer on :8879
// (pick a persona, no password); deployed it comes from the real one. Same code.
// ============================================================================

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

/** Who the caller is in gym vocabulary — decided by the kernel, not the client. */
export interface WhoAmI {
  principal: string;
  role: 'admin' | 'coach' | 'trainee';
  name: string | null;
  recordId: string | null;
  /** Their own trainee record, if they have one. Staff can have both — an admin
   *  who runs the gym and also trains in it is the single-person gym. */
  traineeId: string | null;
}

export interface CastMember {
  key: string;
  name: string;
  role: 'admin' | 'coach' | 'trainee' | 'outsider';
  subjectId: string | null;
  /** Whose training is "mine" — null for staff who have not enrolled themselves. */
  traineeId: string | null;
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
  /** 'unilateral' means one side at a time: every set names left or right, and
   *  a prescription's `target_sets` counts per side. */
  laterality: 'bilateral' | 'unilateral';
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

export type Side = 'left' | 'right';

export interface ItemSet {
  id: string;
  /** Numbered PER SIDE on a unilateral exercise: left 1, 2 and right 1, 2. */
  set_no: number;
  target_reps: number;
  target_load: string | null;
  note: string | null;
  side: Side | null;
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
  laterality: 'bilateral' | 'unilateral';
  targetSets: number;
  targetReps: number;
  targetLoad: string | null;
  recurDays: string | null;
  recurPerWeek: number | null;
  dueToday: boolean;
  doneThisWeek: number;
  targetThisWeek: number;
}

/**
 * A PLAN — the reusable prescription, tied to nobody. A workout is one person's
 * run of a plan, snapshot from it at creation.
 */
export interface Template {
  id: string;
  name: string;
  description: string | null;
  /** 'shared' is on the gym's shelf — the library, or a member's plan they shared. */
  visibility: 'shared' | 'private';
  items: Item[];
  /** Who made it, when a member did. Null on the gym's own library plans. */
  ownerName: string | null;
  /** Yours: you may edit, share and withdraw it. */
  mine: boolean;
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
  /** Which arm, which leg. Set on a unilateral exercise, null otherwise. */
  side: Side | null;
  /** When this set was performed. The server has always sent it; declaring it is
   *  what lets a session's END be derived instead of guessed at from a device. */
  logged_at: string;
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
  /** The engine's customer — for this vertical, always the trainee the
   *  programme is FOR. Declared because the screen needs to say whose progress
   *  to open, and staff opening a trainee's baseline are not that trainee. */
  customer: { entityType: string; entityId: string };
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

// --- the body, and the curve ------------------------------------------------

export type MeasurementKind =
  | 'weight'
  | 'body-fat'
  | 'resting-hr'
  | 'waist'
  | 'chest'
  | 'hips'
  | 'upper-arm'
  | 'forearm'
  | 'thigh'
  | 'calf'
  | 'grip'
  | 'shoulder-flexion'
  | 'shoulder-abduction'
  | 'shoulder-external-rotation';

/** Mirrors MEASUREMENT_KINDS in module.ts: the unit each kind is in, and
 *  whether it belongs to a side. The server refuses anything else. */
export const MEASUREMENT_KINDS: Record<MeasurementKind, { unit: string; sided: boolean; label: string }> = {
  weight: { unit: 'kg', sided: false, label: 'Body weight' },
  'body-fat': { unit: '%', sided: false, label: 'Body fat' },
  'resting-hr': { unit: 'bpm', sided: false, label: 'Resting heart rate' },
  waist: { unit: 'cm', sided: false, label: 'Waist' },
  chest: { unit: 'cm', sided: false, label: 'Chest' },
  hips: { unit: 'cm', sided: false, label: 'Hips' },
  'upper-arm': { unit: 'cm', sided: true, label: 'Upper arm' },
  forearm: { unit: 'cm', sided: true, label: 'Forearm' },
  thigh: { unit: 'cm', sided: true, label: 'Thigh' },
  calf: { unit: 'cm', sided: true, label: 'Calf' },
  grip: { unit: 'kg', sided: true, label: 'Grip strength' },
  'shoulder-flexion': { unit: 'deg', sided: true, label: 'Shoulder flexion — arm forward and up' },
  'shoulder-abduction': { unit: 'deg', sided: true, label: 'Shoulder abduction — arm out to the side' },
  'shoulder-external-rotation': { unit: 'deg', sided: true, label: 'Shoulder external rotation' },
};

export interface Measurement {
  id: string;
  trainee_id: string;
  kind: MeasurementKind;
  side: Side | null;
  /** A decimal string, exactly as entered. */
  value: string;
  unit: string;
  measured_at: string;
  note: string | null;
}

export interface ProgressPoint {
  sessionId: string;
  programId: string;
  /** 'assessment' is a baseline point. */
  programKind: string;
  performedAt: string;
  sets: number;
  bestReps: number;
  bestLoad: string | null;
  totalQuantity: number;
  volume: string;
  totalSeconds: number;
  paceSecondsPerKm: number | null;
  avgHr: number | null;
}

export interface Symmetry {
  performedAt: string;
  measure: 'volume' | 'quantity';
  left: string;
  right: string;
  weaker: Side | null;
  /** The weaker side as a percentage of the stronger — '66.66'. */
  weakerPct: string;
}

export interface ExerciseProgress {
  exerciseId: string;
  slug: string;
  name: string;
  unit: string;
  modality: string;
  laterality: 'bilateral' | 'unilateral';
  series: { side: Side | null; points: ProgressPoint[] }[];
  symmetry: Symmetry | null;
}

export interface Progress {
  traineeId: string;
  /** Sessions the kernel let you see. 0 is "nothing shared", not "nothing done". */
  sessionsSeen: number;
  exercises: ExerciseProgress[];
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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

  meTrainee: () => get<Me | null>('/me/trainee'),
  /** Enrol yourself as a trainee — admin only, and idempotent. */
  trainMyself: (name?: string) => post<Trainee>('/me/trainee', name ? { name } : {}),
  onboard: (goal: Goal, daysPerWeek: number) => post<Me>('/me/onboard', { goal, daysPerWeek }),
  setItemSets: (
    itemId: string,
    sets: { reps: number; load?: string; note?: string; side?: Side }[],
  ) => post<unknown>(`/items/${itemId}/sets`, { sets }),

  // The body and the curve, both BY TRAINEE — pass `me.traineeId` for your own.
  measurements: (traineeId: string) => get<Measurement[]>(`/trainees/${traineeId}/measurements`),
  logMeasurement: (
    traineeId: string,
    b: { kind: MeasurementKind; side?: Side; value: string; measuredAt?: string; note?: string },
  ) => post<Measurement>(`/trainees/${traineeId}/measurements`, b),
  progress: (traineeId: string) => get<Progress>(`/trainees/${traineeId}/progress`),

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
  /** The default library a new gym opens with. Idempotent — a second press adds
   *  only what is still missing. */
  installStarterLibrary: () =>
    post<{ equipment: number; exercises: number; templates: number; alreadyInstalled: boolean }>(
      '/library/install',
    ),
  authorTemplate: (b: unknown) => post<Template>('/templates/author', b),
  addTemplateItem: (id: string, b: unknown) => post<Item>(`/templates/${id}/items`, b),
  removeTemplateItem: (itemId: string) => post<{ removed: string }>(`/template-items/${itemId}/remove`),
  /** Put a plan you made in front of the whole gym, or take it back. */
  shareTemplate: (id: string, withWhom: 'gym' | 'nobody') =>
    post<Template>(`/templates/${id}/share`, { with: withWhom }),

  coaches: () => get<Coach[]>('/coaches'),
  trainees: () => get<Trainee[]>('/trainees'),
  createTrainee: (b: unknown) => post<Trainee>('/trainees', b),

  programs: () => get<ProgramCard[]>('/programs'),
  program: (id: string) => get<ProgramDetail>(`/programs/${id}`),
  assignProgram: (b: unknown) => post<{ program: ProgramCard }>('/programs', b),

  /**
   * Set up a standing workout: create it and book it, and LEAVE IT PLANNED.
   *
   * It used to start it too, in the same gesture. That was one step too eager —
   * a workout built from a template, or from nothing, is almost never right
   * first time, and the moment between creating it and training is exactly when
   * you swap an exercise or take the reps down. So this lands you on the
   * programme with `Start it` in front of you, rather than mid-session in
   * something you have not read.
   *
   * Two calls rather than one operation on purpose, and `workorder/start` stays
   * out on its own: it carries the manifest guard, and an in-scope shortcut
   * around it would be the hole that guard exists to close.
   */
  createRoutine: async (input: {
    title: string;
    kind: string;
    templateId?: string;
    slots: { weekday: number; time: string }[];
  }) => {
    const { program } = await post<{ program: ProgramCard }>('/programs', input);
    return program;
  },
  addProgramItem: (programId: string, b: unknown) => post<Item>(`/programs/${programId}/items`, b),
  removeProgramItem: (itemId: string) => post<{ removed: string }>(`/items/${itemId}/remove`),
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
