import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ============================================================================
// THE ACTIVE SESSION — a device-local fact, deliberately.
//
// The domain has no session END. `train_sessions` is append-only: it records
// `performed_at` and nothing that says the session stopped, because what the gym
// keeps is what was PERFORMED, not how long a phone had a screen open. So "a
// session is running" is not a fact to fetch — it is state belonging to this
// device, and it lives here rather than in a migration.
//
// That is also why finishing needs no operation. Ending a session writes
// nothing: every set was already logged when it happened, so the finish card is
// a summary of rows that are already durable, not a save.
//
// Persisted to localStorage so a refresh mid-workout does not lose the clock —
// the one thing here that cannot be recomputed.
// ============================================================================

export interface ActiveSession {
  programId: string;
  name: string;
  /** ISO — when the CURRENT run of the clock began (moves on resume). */
  startedAt: string;
  /** ISO while paused, null while running. */
  pausedAt: string | null;
  /** Milliseconds banked by earlier runs, before the current one. */
  accumulatedMs: number;
  /** Exercises logged / prescribed. Reported by the logging screen; unknown
   *  until you have been there, so the bar's subline is optional. */
  done?: number;
  total?: number;
}

const KEY = 'stride:active-session';

function read(): ActiveSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveSession) : null;
  } catch {
    return null;
  }
}

let current: ActiveSession | null = read();
/** Transient, never persisted: a refresh must not replay the countdown. */
let countingDown = false;
const listeners = new Set<() => void>();

function commit(next: ActiveSession | null) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // A private window with storage disabled still gets a working session —
    // it just does not survive a reload. Never a thrown error mid-workout.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useActiveSession(): ActiveSession | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export function useCountingDown(): boolean {
  return useSyncExternalStore(subscribe, () => countingDown, () => false);
}

export function startSession(programId: string, name: string, resumed = false): void {
  // Tapping into a session you are already in must not restart its clock, and
  // resuming is not a start — the countdown belongs to the moment you begin.
  if (current?.programId === programId) {
    countingDown = false;
    listeners.forEach((l) => l());
    return;
  }
  countingDown = !resumed && !prefersReducedMotion();
  commit({
    programId,
    name,
    startedAt: new Date().toISOString(),
    pausedAt: null,
    accumulatedMs: 0,
  });
}

export function endCountdown(): void {
  countingDown = false;
  listeners.forEach((l) => l());
}

export function endSession(): void {
  countingDown = false;
  commit(null);
}

/** The finish card, raised from the logging screen and rendered at the shell —
 *  transient, because a receipt you have already read should not survive a
 *  reload and greet you again. */
let finished: SessionSummary | null = null;

export function useFinishSummary(): SessionSummary | null {
  return useSyncExternalStore(subscribe, () => finished, () => null);
}

/** End the session and show its receipt in one act — they are one decision. */
export function finishSession(summary: SessionSummary): void {
  finished = summary;
  endSession();
}

export function dismissFinish(): void {
  finished = null;
  listeners.forEach((l) => l());
}

export function pauseSession(): void {
  if (!current || current.pausedAt) return;
  const now = new Date();
  commit({
    ...current,
    pausedAt: now.toISOString(),
    accumulatedMs: current.accumulatedMs + (now.getTime() - Date.parse(current.startedAt)),
  });
}

export function resumeSession(): void {
  if (!current?.pausedAt) return;
  commit({ ...current, startedAt: new Date().toISOString(), pausedAt: null });
}

/** The logging screen knows the counts; nothing else has to fetch them. */
export function reportProgress(programId: string, done: number, total: number): void {
  if (!current || current.programId !== programId) return;
  if (current.done === done && current.total === total) return;
  commit({ ...current, done, total });
}

export function elapsedMs(s: ActiveSession): number {
  if (s.pausedAt) return s.accumulatedMs;
  return s.accumulatedMs + (Date.now() - Date.parse(s.startedAt));
}

/** `41:12`, and `1:02:33` once it has been an hour. Tabular by CSS, not padding. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Ticks once a second, and only while running — a paused clock re-renders never. */
export function useElapsed(s: ActiveSession | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!s || s.pausedAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [s?.startedAt, s?.pausedAt]);
  return s ? elapsedMs(s) : 0;
}

// ============================================================================
// THE THREE MOMENTS. Everything else in the app is static; these are the only
// places anything moves, and each one is skipped entirely under
// `prefers-reduced-motion` rather than merely shortened.
// ============================================================================

/**
 * 3 · 2 · 1 over the workout. The canvas loops it forever because a canvas has
 * to; here it runs ONCE and hands control back — the session is already open by
 * the time this shows, so Skip costs nothing but the wait.
 */
export function SessionCountdown({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 3000);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="countdown" role="status" aria-live="polite">
      <div className="countdown-label">Starting session</div>
      <div className="countdown-digits" aria-hidden="true">
        <span>3</span>
        <span>2</span>
        <span>1</span>
      </div>
      <div className="countdown-name">{name}</div>
      <button className="countdown-skip" onClick={onDone}>
        Skip
      </button>
    </div>
  );
}

/**
 * The bar. Docks above the tab bar on every screen, and it is ONE button: the
 * whole thing returns you to the workout you are in the middle of.
 *
 * The subline is omitted rather than guessed at when the counts are unknown —
 * a fresh reload has not been to the logging screen yet, and "0 of 0" would be
 * a lie about a session you are demonstrably in.
 */
export function SessionBar({ onOpen }: { onOpen: (programId: string) => void }) {
  const session = useActiveSession();
  const ms = useElapsed(session);
  if (!session) return null;
  const counts =
    session.total !== undefined && session.done !== undefined
      ? `${session.done} of ${session.total} exercises logged`
      : session.pausedAt
        ? 'paused'
        : 'session in progress';

  return (
    <button className="session-bar" onClick={() => onOpen(session.programId)}>
      <span className={`session-dot${session.pausedAt ? ' held' : ''}`} />
      <span className="session-what">
        <span className="session-name">{session.name}</span>
        <span className="session-sub">{counts}</span>
      </span>
      <span className="session-clock mono">{formatClock(ms)}</span>
      <span className="chev">›</span>
    </button>
  );
}

export interface SessionSummary {
  name: string;
  ms: number;
  sets: number;
  done: number;
  total: number;
  volume: string | null;
  /** An exercise earned during this session, if one was. */
  earned: string | null;
}

/** Ten pieces, the canvas's own colours and timings. Rendered only once, and
 *  never at all under reduced motion. */
const CONFETTI = [
  { left: '8%', delay: '0s', dur: '3.4s', color: 'var(--accent)', dot: false },
  { left: '18%', delay: '0.4s', dur: '4.1s', color: 'var(--warn)', dot: true },
  { left: '27%', delay: '0.15s', dur: '3.8s', color: 'var(--share)', dot: false },
  { left: '38%', delay: '0.7s', dur: '4.6s', color: 'var(--deny)', dot: false },
  { left: '47%', delay: '0.25s', dur: '3.2s', color: 'var(--accent)', dot: true },
  { left: '58%', delay: '0.55s', dur: '4.3s', color: 'var(--share)', dot: false },
  { left: '67%', delay: '0.1s', dur: '3.6s', color: 'var(--warn)', dot: false },
  { left: '76%', delay: '0.8s', dur: '4.0s', color: 'var(--accent)', dot: true },
  { left: '85%', delay: '0.35s', dur: '3.9s', color: 'var(--deny)', dot: false },
  { left: '93%', delay: '0.6s', dur: '4.4s', color: 'var(--share)', dot: false },
];

/**
 * Session done. Writes nothing — every set was logged as it happened, so this
 * is a receipt for rows that are already durable.
 */
export function SessionFinish({
  summary,
  onDone,
  onAdherence,
}: {
  summary: SessionSummary;
  onDone: () => void;
  onAdherence: () => void;
}) {
  const quiet = useRef(prefersReducedMotion()).current;
  return (
    <div className="finish">
      {!quiet && (
        <div className="confetti" aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className={c.dot ? 'bit dot' : 'bit'}
              style={{ left: c.left, background: c.color, animationDelay: c.delay, animationDuration: c.dur }}
            />
          ))}
        </div>
      )}
      <div className="card raised finish-card">
        <span className={`disc${quiet ? '' : ' pop'}`}>
          <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 10.5 8.5 15 16 5.5" />
          </svg>
        </span>
        <div className="finish-head">Session done</div>
        <div className="finish-sub mono">
          {summary.name} · {formatClock(summary.ms)}
        </div>
        <div className="finish-stats">
          <div>
            <div className="finish-stat mono">{summary.sets}</div>
            <div className="finish-label">sets</div>
          </div>
          <div>
            <div className="finish-stat mono">
              {summary.done}/{summary.total}
            </div>
            <div className="finish-label">exercises</div>
          </div>
          {summary.volume && (
            <div>
              <div className="finish-stat mono">
                {summary.volume}
                <span className="finish-unit"> kg</span>
              </div>
              <div className="finish-label">volume</div>
            </div>
          )}
        </div>
        {summary.earned && (
          <div className="finish-earned">
            <span className="finish-earned-label">Yours forever</span>
            <div className="finish-earned-body">{summary.earned} earned into your library.</div>
          </div>
        )}
        <button className="primary wide" onClick={onDone}>
          Done
        </button>
        <button className="ghost wide finish-quiet" onClick={onAdherence}>
          View adherence
        </button>
      </div>
    </div>
  );
}
