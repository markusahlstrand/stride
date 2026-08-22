import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  DEV,
  api,
  currentPrincipal,
  setPrincipal,
  type CastMember,
  type AuthSession,
} from './api';
import {
  ChatScreen,
  LibraryScreen,
  PeopleScreen,
  ProgramDetailScreen,
  ProgramsScreen,
  ThreadScreen,
  TodayScreen,
  TraineesScreen,
} from './screens';
import {
  EXERCISES_DEFAULT,
  tabOf,
  useRoute,
  writePrincipalToUrl,
  type Route,
} from './router';

// ============================================================================
// The shell: the dev persona picker, a notice banner, and the bottom tab bar.
//
// WHERE YOU ARE LIVES IN THE URL, not in React state — see router.ts. Refresh
// lands you back on the same screen, Back works, and a workout has a link.
//
// The banner is the point of the app, not decoration. When the kernel refuses
// something it arrives here as a 403 with the permission that was denied — so
// switching to a persona who shouldn't be able to do a thing, and watching the
// refusal land, is a first-class part of the UI rather than a stack trace.
// ============================================================================

export type Notice = { kind: 'deny' | 'error' | 'good'; text: string } | null;

export function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setNotice({ kind: 'good', text: ok });
      else setNotice(null);
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice({ kind: err.denied ? 'deny' : 'error', text: err.message });
      } else {
        setNotice({ kind: 'error', text: String(err) });
      }
      return false;
    }
  }, []);
  return { notice, setNotice, run };
}

/**
 * The two screens a signed-out visitor can see. They are not error states: an
 * unclaimed gym and a valid login with no seat are both normal, and the second is
 * the whole point — authenticating proves who you are, never that you belong here.
 */
function Gate({ title, body, action, href }: { title: string; body: string; action: string; href: string }) {
  return (
    <div className="app">
      <main className="gate">
        <h1>{title}</h1>
        <p>{body}</p>
        <a className="primary" href={href}>
          {action}
        </a>
      </main>
    </div>
  );
}

export function App() {
  const [cast, setCast] = useState<CastMember[]>([]);
  const [me, setMe] = useState<CastMember | null>(null);
  /** Deployed only. In dev the persona picker IS the session. */
  const [session, setSession] = useState<AuthSession | null>(null);
  const [route, navigate] = useRoute();
  const [unread, setUnread] = useState(0);
  const { notice, setNotice, run } = useNotice();

  useEffect(() => {
    if (DEV) {
      // Make the address bar honest on first load, so a copied link carries the
      // persona even when it was only ever in localStorage.
      writePrincipalToUrl(currentPrincipal());
      api.cast().then(setCast).catch(() => undefined);
      return;
    }
    // Deployed: the worker answers this while signed out, so a failure here is a
    // broken instance, not a signed-out one — treat it as signed out either way
    // rather than hanging on a spinner nobody can get past.
    api
      .session()
      .then(setSession)
      .catch(() =>
        setSession({
          signedIn: false,
          seated: false,
          needsSetup: false,
          principal: null,
          email: null,
          name: null,
        }),
      );
  }, []);

  useEffect(() => {
    if (DEV) {
      api.me().then(setMe).catch(() => setMe(null));
      return;
    }
    if (!session?.seated) {
      setMe(null);
      return;
    }
    // The role comes from the KERNEL-checked operation, not from the session:
    // the session says which principal you are, `whoami` says what you are in
    // this gym — and refuses if you are nothing in it.
    api
      .whoami()
      .then((who) =>
        setMe({
          key: who.principal,
          name: who.name ?? session.name ?? session.email ?? 'You',
          role: who.role,
          subjectId: null,
        }),
      )
      .catch(() => setMe(null));
  }, [cast.length, session?.seated, session?.email, session?.name]);

  const switchTo = (key: string) => {
    setPrincipal(key);
    writePrincipalToUrl(key);
    setNotice(null);
    navigate({ name: 'today' });
    api.me().then(setMe).catch(() => setMe(null));
  };

  const staff = me?.role === 'admin' || me?.role === 'coach';
  const tab = tabOf(route, me?.role);
  const openWorkout = (id: string) => navigate({ name: 'workout', id });
  const openThread = (traineeId: string, coachId: string) =>
    navigate({ name: 'thread', traineeId, coachId });

  // Unread is a NOTIFICATION, not a destination: it rides the tab that leads to
  // the conversation rather than claiming one of its own.
  useEffect(() => {
    let live = true;
    const poll = () =>
      api
        .threads()
        .then((t) => live && setUnread(t.reduce((n, x) => n + x.unread, 0)))
        .catch(() => live && setUnread(0));
    poll();
    const id = window.setInterval(poll, 20_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [me?.key, route.name]);

  // The gates, deployed only. Every hook above has already run, so these returns
  // change what is rendered and never the order anything is called in.
  if (!DEV) {
    if (!session) return <div className="app" />;
    if (!session.signedIn)
      return (
        <Gate
          title={session.needsSetup ? 'Claim this gym' : 'Stride'}
          body={
            session.needsSetup
              ? 'Nobody runs this gym yet. The first person to sign in claims it and becomes its admin.'
              : 'Sign in to see your workouts.'
          }
          action={session.needsSetup ? 'Sign in and claim it' : 'Sign in'}
          href="/api/auth/login"
        />
      );
    if (!session.seated)
      return (
        <Gate
          title="Not a member here"
          body={`You are signed in${
            session.email ? ` as ${session.email}` : ''
          }, but this account has no seat in this gym. Ask an admin for an invitation.`}
          action="Sign out"
          href="/api/auth/logout"
        />
      );
  }

  return (
    <div className="app">
      <header className="who">
        {DEV ? (
          <>
            <div>
              <div className="seam">DEV PRINCIPAL</div>
            </div>
            <select value={currentPrincipal()} onChange={(e) => switchTo(e.target.value)}>
              {cast.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} · {c.role}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <div>
              <div className="seam">SIGNED IN</div>
              {me?.name ?? session?.email ?? ''}
            </div>
            <a className="signout" href="/api/auth/logout">
              Sign out
            </a>
          </>
        )}
      </header>

      <main>
        {notice && (
          <div className={`banner ${notice.kind}`} onClick={() => setNotice(null)}>
            <b>
              {notice.kind === 'deny'
                ? 'Denied by the kernel'
                : notice.kind === 'good'
                  ? 'Done'
                  : 'Rejected'}
            </b>
            {notice.text}
          </div>
        )}

        {route.name === 'workout' ? (
          <ProgramDetailScreen
            programId={route.id}
            me={me}
            run={run}
            onBack={() => navigate({ name: 'workouts' })}
          />
        ) : route.name === 'thread' ? (
          <ThreadScreen
            traineeId={route.traineeId}
            coachId={route.coachId}
            me={me}
            run={run}
            onBack={() => navigate({ name: 'chat' })}
          />
        ) : route.name === 'chat' ? (
          <ChatScreen me={me} run={run} onOpen={openThread} />
        ) : route.name === 'trainees' ? (
          <TraineesScreen
            me={me}
            run={run}
            onOpen={openWorkout}
            onThread={openThread}
          />
        ) : route.name === 'workouts' ? (
          <ProgramsScreen me={me} run={run} onOpen={openWorkout} />
        ) : route.name === 'exercises' ? (
          <LibraryScreen
            me={me}
            run={run}
            filters={route}
            onFilters={(next: Route) => navigate(next, true)}
          />
        ) : route.name === 'me' ? (
          <PeopleScreen
            me={me}
            run={run}
            onOpen={openWorkout}
            onThread={openThread}
            onBrowse={() => navigate(EXERCISES_DEFAULT as Route)}
          />
        ) : (
          <TodayScreen me={me} run={run} onOpen={openWorkout} />
        )}
      </main>

      <nav className="tabs">
        {/*
          The bar follows the PERSON, not the schema. Exercises are part of a
          workout and are reached from one (or from your own library on Me), so
          they are no longer a destination; a conversation belongs to the person
          it is with, so it hangs off Trainees or Me and announces itself with a
          count instead of a tab. Me is last, where a profile always is.
        */}
        {(staff
          ? ([
              ['today', '◷', 'Today', { name: 'today' } as Route, 0],
              ['workouts', '▤', 'Programmes', { name: 'workouts' } as Route, 0],
              ['trainees', '☺', 'Trainees', { name: 'trainees' } as Route, unread],
              ['me', '⊙', 'Me', { name: 'me' } as Route, 0],
            ] as const)
          : ([
              ['today', '◷', 'Today', { name: 'today' } as Route, 0],
              ['workouts', '▤', 'Workouts', { name: 'workouts' } as Route, 0],
              ['me', '⊙', 'Me', { name: 'me' } as Route, unread],
            ] as const)
        ).map(([key, glyph, label, target, badge]) => (
          <button
            key={key}
            className={tab === key ? 'on' : ''}
            onClick={() => {
              setNotice(null);
              navigate(target);
            }}
          >
            <span className="glyph">
              {glyph}
              {badge > 0 && <span className="dot">{badge > 9 ? '9+' : badge}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
