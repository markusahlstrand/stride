import { useCallback, useEffect, useState } from 'react';

// ============================================================================
// URL IS THE STATE.
//
// Every screen the app can be on is addressable, so a refresh lands you back
// where you were, the back button works, and a link to a workout is a link to
// that workout. Nothing that decides what you are looking at lives in React
// state any more.
//
// Two places, on purpose:
//
//   the HASH   holds the route — `#/workouts/01J…`, `#/exercises?q=row`. A hash
//              needs no server rewrite, so a deep link survives being opened
//              from a static host, not just from the dev server.
//   `?as=`     holds the DEV PRINCIPAL. It is deliberately outside the hash: it
//              is not part of where you are, it is who you are pretending to be,
//              and it should survive navigating between routes.
//
// `?as=` is a dev seam like the `x-principal` header it feeds. Real auth puts
// the identity in a session, and this parameter disappears with it.
// ============================================================================

export type Route =
  | { name: 'today' }
  | { name: 'workouts' }
  | { name: 'workout'; id: string }
  | { name: 'chat' }
  | { name: 'trainees' }
  | { name: 'thread'; traineeId: string; coachId: string }
  | { name: 'me' }
  | {
      name: 'exercises';
      q: string;
      types: string[];
      privateOnly: boolean;
      myKit: boolean;
      equipment: string[];
    };

export const EXERCISES_DEFAULT: Extract<Route, { name: 'exercises' }> = {
  name: 'exercises',
  q: '',
  types: [],
  privateOnly: false,
  myKit: false,
  equipment: [],
};

const list = (raw: string | null): string[] =>
  raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/today';
  const [path, search] = raw.split('?');
  const q = new URLSearchParams(search ?? '');
  const parts = path.split('/').filter(Boolean);

  switch (parts[0]) {
    case 'workouts':
      return parts[1] ? { name: 'workout', id: parts[1] } : { name: 'workouts' };
    case 'chat':
      return parts[1] && parts[2]
        ? { name: 'thread', traineeId: parts[1], coachId: parts[2] }
        : { name: 'chat' };
    case 'trainees':
      return { name: 'trainees' };
    case 'me':
      return { name: 'me' };
    case 'exercises':
      return {
        name: 'exercises',
        q: q.get('q') ?? '',
        types: list(q.get('type')),
        privateOnly: q.get('private') === '1',
        myKit: q.get('kit') === '1',
        equipment: list(q.get('eq')),
      };
    default:
      return { name: 'today' };
  }
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'workouts':
      return '#/workouts';
    case 'workout':
      return `#/workouts/${route.id}`;
    case 'chat':
      return '#/chat';
    case 'thread':
      return `#/chat/${route.traineeId}/${route.coachId}`;
    case 'trainees':
      return '#/trainees';
    case 'me':
      return '#/me';
    case 'exercises': {
      const q = new URLSearchParams();
      if (route.q) q.set('q', route.q);
      if (route.types.length) q.set('type', route.types.join(','));
      if (route.privateOnly) q.set('private', '1');
      if (route.myKit) q.set('kit', '1');
      if (route.equipment.length) q.set('eq', route.equipment.join(','));
      const s = q.toString();
      return s ? `#/exercises?${s}` : '#/exercises';
    }
    default:
      return '#/today';
  }
}

/** The tab a route belongs to, so the bottom bar can light the right one. */
/**
 * Which TAB a route belongs under. Several routes have no tab of their own any
 * more — the exercise library and a conversation are things you reach from
 * somewhere, not places in the bar — so they light the tab you got there from.
 */
export function tabOf(route: Route, role: string | undefined): string {
  const staff = role === 'admin' || role === 'coach';
  if (route.name === 'workout') return 'workouts';
  // A conversation belongs to the person it is with: their roster for staff,
  // your own coaches for a trainee.
  if (route.name === 'thread' || route.name === 'chat') return staff ? 'trainees' : 'me';
  // The library is reached from a workout or from Me; it is not a destination.
  if (route.name === 'exercises') return staff ? 'workouts' : 'me';
  return route.name;
}

export function useRoute(): [Route, (next: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const navigate = useCallback((next: Route, replace = false) => {
    const url = `${window.location.pathname}${window.location.search}${formatRoute(next)}`;
    // Typing in a filter should not push a history entry per keystroke — that
    // turns Back into "undo one character". Filters replace; navigation pushes.
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setRoute(next);
  }, []);

  return [route, navigate];
}

/** The dev principal, from `?as=` — outside the hash because it is not a place. */
export function principalFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('as');
}

export function writePrincipalToUrl(key: string): void {
  const q = new URLSearchParams(window.location.search);
  q.set('as', key);
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}?${q.toString()}${window.location.hash}`,
  );
}
