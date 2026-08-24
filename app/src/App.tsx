import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  api,
  type CastMember,
  type AuthSession,
} from './api';
import {
  ChatScreen,
  initials,
  LibraryScreen,
  PeopleScreen,
  ProgramDetailScreen,
  ProgramsScreen,
  ThreadScreen,
  TodayScreen,
  TraineesScreen,
} from './screens';
import { EXERCISES_DEFAULT, tabOf, useRoute, type Route } from './router';
import {
  SessionBar,
  SessionCountdown,
  SessionFinish,
  dismissFinish,
  endCountdown,
  useActiveSession,
  useCountingDown,
  useFinishSummary,
} from './session';
import {
  BarbellIcon,
  CalendarIcon,
  ClipboardIcon,
  PeopleIcon,
  PersonIcon,
} from './icons';

// ============================================================================
// The shell: the signed-in header, a notice banner, and the bottom tab bar.
//
// WHERE YOU ARE LIVES IN THE URL, not in React state — see router.ts. Refresh
// lands you back on the same screen, Back works, and a workout has a link.
//
// The banner is the point of the app, not decoration. When the kernel refuses
// something it arrives here as a 403 with the permission that was denied — so
// signing in as someone who shouldn't be able to do a thing, and watching the
// refusal land, is a first-class part of the UI rather than a stack trace.
// Switching person is a sign-out and a sign-in now, which is what it always
// really was; the dev issuer keeps no SSO cookie, so it costs one click.
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
function Gate({
  title,
  body,
  action,
  href,
  quiet,
}: {
  title: string;
  body: string;
  action: string;
  href: string;
  /** A sign-out is a way back, not the thing to do — so it is not the primary. */
  quiet?: boolean;
}) {
  return (
    <div className="app">
      <main className="gate">
        <div className="wordmark">Stride</div>
        <div className={quiet ? 'card' : 'card raised'}>
          <h1>{title}</h1>
          <p>{body}</p>
          <a className={quiet ? 'default' : 'primary'} href={href}>
            {action}
          </a>
        </div>
      </main>
    </div>
  );
}

/**
 * A denial arrives as `permission denied: result:log`. The key is worth pulling
 * out and setting in mono: it is the exact thing the kernel checked, and naming
 * it turns "something went wrong" into a fact you can act on.
 */
function splitDenial(text: string): { perm: string | null; rest: string } {
  const m = /^permission denied:\s*(\S+)\s*(.*)$/s.exec(text);
  if (!m) return { perm: null, rest: text };
  return { perm: m[1]!, rest: m[2]!.trim() };
}

/**
 * The banner is the point of the app, not decoration — so a refusal gets a
 * headline, the permission that was checked, and one plain sentence saying that
 * nothing changed. Sticky under the header, dismissed by tapping it.
 */
function NoticeBanner({ notice, onDismiss }: { notice: NonNullable<Notice>; onDismiss: () => void }) {
  const { perm, rest } = notice.kind === 'deny' ? splitDenial(notice.text) : { perm: null, rest: notice.text };
  return (
    <div className={`banner ${notice.kind}`} onClick={onDismiss}>
      <div className="head">
        <b>
          {notice.kind === 'deny'
            ? 'Denied by the kernel'
            : notice.kind === 'good'
              ? 'Done'
              : 'Rejected'}
        </b>
        {perm && <span className="perm">{perm}</span>}
      </div>
      <div className="body">
        {perm ? (
          <>
            You don&apos;t hold <span className="mono">{perm}</span> here.{' '}
            {rest ? `${rest} ` : ''}Nothing was changed — the kernel said no, and that is the
            whole story.
          </>
        ) : (
          notice.text
        )}
      </div>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<CastMember | null>(null);
  /** Both runtimes. The dev issuer and the hosted one answer the same shape. */
  const [session, setSession] = useState<AuthSession | null>(null);
  const [route, navigate] = useRoute();
  const [unread, setUnread] = useState(0);
  // The active WORKOUT session — device-local state, not a fetch (see
  // `session.tsx`). Named apart from the auth `session` above: they are two
  // different things and one of them is a clock.
  const workout = useActiveSession();
  const countingDown = useCountingDown();
  const finished = useFinishSummary();
  const { notice, setNotice, run } = useNotice();

  useEffect(() => {
    // Answered while signed out, so a failure here is a broken instance, not a
    // signed-out one — treat it as signed out either way rather than hanging on
    // a spinner nobody can get past.
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
          subjectId: who.recordId,
        }),
      )
      .catch(() => setMe(null));
  }, [session?.seated, session?.email, session?.name]);

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

  // The gates, in BOTH runtimes. Every hook above has already run, so these
  // returns change what is rendered and never the order anything is called in.
  // Locally these are the screens the dev issuer sends you through, which is the
  // point: the sign-in path the deployment runs is the one you see all day.
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
        quiet
      />
    );

  return (
    <div className="app">
      <main>
        {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}

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
          <TodayScreen
            me={me}
            run={run}
            onOpen={openWorkout}
            onSetup={() => navigate({ name: 'me' })}
          />
        )}
      </main>

      {workout && <SessionBar onOpen={(id) => navigate({ name: 'workout', id })} />}

      <nav className="tabs">
        {/* Desktop only (hidden under the breakpoint): the rail's wordmark, and
            at its foot the signed-in person. Identity comes BACK here because the
            desktop design asks for it — on mobile there is no chrome to hold it,
            which is why it lives on Me. */}
        <div className="rail-mark">Stride</div>
        {/*
          The bar follows the PERSON, not the schema. Exercises are part of a
          workout and are reached from one (or from your own library on Me), so
          they are no longer a destination; a conversation belongs to the person
          it is with, so it hangs off Trainees or Me and announces itself with a
          count instead of a tab. Me is last, where a profile always is.
        */}
        {(staff
          ? ([
              ['today', CalendarIcon, 'Today', { name: 'today' } as Route, 0],
              ['workouts', ClipboardIcon, 'Programmes', { name: 'workouts' } as Route, 0],
              ['trainees', PeopleIcon, 'Trainees', { name: 'trainees' } as Route, unread],
              ['me', PersonIcon, 'Me', { name: 'me' } as Route, 0],
            ] as const)
          : ([
              ['today', CalendarIcon, 'Today', { name: 'today' } as Route, 0],
              ['workouts', BarbellIcon, 'Workouts', { name: 'workouts' } as Route, 0],
              ['me', PersonIcon, 'Me', { name: 'me' } as Route, unread],
            ] as const)
        ).map(([key, Glyph, label, target, badge]) => (
          <button
            key={key}
            className={tab === key ? 'on' : ''}
            onClick={() => {
              setNotice(null);
              navigate(target);
            }}
          >
            <span className="glyph">
              <Glyph />
              {badge > 0 && <span className="dot">{badge > 9 ? '9+' : badge}</span>}
            </span>
            {label}
          </button>
        ))}

        {/* Above the tab bar, below everything else — a sibling of the bar so
            its own margins hold it clear. */}
        {me && (
          <div className="rail-user">
            <span className="avatar">{initials(me.name)}</span>
            <span className="rail-name">{me.name}</span>
          </div>
        )}
      </nav>

      {/* The two moments that take over the screen. Both are transient and
          neither writes anything — the sets were logged as they happened. */}
      {countingDown && workout && (
        <SessionCountdown name={workout.name} onDone={endCountdown} />
      )}
      {finished && (
        <SessionFinish
          summary={finished}
          onDone={dismissFinish}
          onAdherence={() => {
            dismissFinish();
            navigate({ name: 'workouts' });
          }}
        />
      )}
    </div>
  );
}
