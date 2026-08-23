import type { DevPersona } from '@substrat-run/dev-issuer';

// ============================================================================
// THE DEV CAST — harness, never module code.
//
// This file is read TWICE and that is the whole point: `substrat-dev-issuer`
// renders it as the picker on its `/authorize` page, and `linkDevIdentities` in
// `seed.ts` binds each `sub` to a principal. One array, so the issuer and the
// directory cannot drift.
//
// `sub` is the JOIN. It is what the issuer asserts in an ID token and what the
// identity directory is keyed on, so the values are stable and readable — they
// outlive a restart and a human reading an identity link should be able to tell
// who it is.
//
// This is NOT a login shortcut in the vertical. The issuer is an ordinary OIDC
// provider whose only concession is that you pick a name instead of typing a
// password; `src/server.ts` is an ordinary relying party in front of it, running
// the SAME `oidcRpAuthProvider` the deployed worker runs. There is no dev-only
// auth branch left to drift.
// ============================================================================

/**
 * The identity pool these subjects live in.
 *
 * Registered `central` in `linkDevIdentities`, which matters: `devLogin.caller()`
 * asks `listIdentityTenants`, and that question is only answerable on a central
 * pool — on a tenant-bound one the same `externalId` in another tenant is a
 * different person, so the kernel refuses to guess rather than leaking a tenant
 * list. Central is also the truth here: one issuer serves both gyms.
 */
export const DEV_PROVIDER = 'oidc:dev-issuer';

/** The subjects, named once so `personas.ts` and `seed.ts` share the literals. */
export const SUB = {
  astrid: 'dev|astrid',
  nina: 'dev|nina',
  ola: 'dev|ola',
  vera: 'dev|vera',
  bjorn: 'dev|bjorn',
  rutger: 'dev|rutger',
  newcomer: 'dev|newcomer',
} as const;

export const PERSONAS: DevPersona[] = [
  {
    sub: SUB.astrid,
    name: 'Astrid Kihlberg',
    email: 'astrid@nordkraft.test',
    note: 'admin — Nordkraft Träning & Rehab',
  },
  {
    sub: SUB.nina,
    name: 'Nina Ljung',
    email: 'nina@nordkraft.test',
    note: "coach — Vera's coach",
  },
  {
    sub: SUB.ola,
    name: 'Ola Sandgren',
    email: 'ola@nordkraft.test',
    note: "coach — Björn's coach",
  },
  { sub: SUB.vera, name: 'Vera Holm', email: 'vera@nordkraft.test', note: 'trainee' },
  { sub: SUB.bjorn, name: 'Björn Ek', email: 'bjorn@nordkraft.test', note: 'trainee' },
  // A legitimate admin of ANOTHER gym. He now signs in to his own tenant, which
  // is the honest shape: there is no cross-tenant API for him to point at this
  // one. The denial he used to demonstrate in the UI is proved where it belongs,
  // against the kernel, in tests 4 and 14.
  {
    sub: SUB.rutger,
    name: 'Rutger Palm',
    email: 'rutger@sydpuls.test',
    note: 'admin — Sydpuls Gym, a different tenant',
  },
  // A real principal holding nothing. Sign in as him to accept an invitation and
  // watch someone become a member of the gym.
  {
    sub: SUB.newcomer,
    name: 'Someone with an invitation',
    email: 'newcomer@example.test',
    note: 'no seat yet — accept an invitation',
  },
];
