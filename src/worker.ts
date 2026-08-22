import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { CloudflareScopeHost, defineScopeDO } from '@substrat-run/adapter-cloudflare';
import { mountOperations, mountPlatformSurface } from '@substrat-run/vertical-host';
import { knownOperations, operations } from './model.js';
import { oidcRpAuthProvider, type AuthProvider, type IdentityDO } from '@substrat-run/vertical-auth';
import { PermissionDenied, readRoutedNode } from '@substrat-run/kernel';
import { z, type PrincipalId, type ScopeId, type TenantId } from '@substrat-run/contracts';
import { AUTH_CONFIG_KEY, ConfigDO } from './config-do.js';
import { MODULES, ROLES } from './modules.js';

// ============================================================================
// THE DEPLOYED VERTICAL — one Durable Object per scope on Cloudflare.
//
// The module set is closed over at BUILD time: a DO cannot receive handler
// closures over RPC, so `defineScopeDO` bakes the kernel, the engines and this
// vertical into the object. `MODULES` comes from `src/modules.ts`, the SAME
// array the local harness registers — so what runs in production is what the
// scenario tests exercised. The worker must never import `seed.ts`: that file
// speaks SQLite, and a Durable Object bundle cannot contain it.
//
// `src/server.ts` stays what it always was: a local dev harness on SQLite, and
// it refuses to start authenticating anyone unless `STRIDE_DEV_AUTH=1`. It is
// not this file, and it is not deployed.
// ============================================================================

export const ScopeDO = defineScopeDO(MODULES, {});

// The identity store, one DO per TENANT. It holds three things the scope DO must
// not: the delivered identity choice, the session-signing secret, and the
// `sub → principal` directory that says who a verified login IS in this gym.
// Config is not domain data and has to survive a scope-DO storage wipe.
export { IdentityDO } from '@substrat-run/vertical-auth';

// LEGACY — still exported and still declared in `runtimeNeeds.stores`, on purpose.
// `ConfigDO` held the same two tables before `IdentityDO` took over (its schema was
// chosen to match, which is why nothing had to be migrated). Cloudflare refuses a
// deploy that drops a Durable Object class without a delete migration, and the
// platform's in-place updater only ever ADDS classes — so retiring this needs a
// platform affordance that does not exist yet. Nothing reads it.
export { ConfigDO } from './config-do.js';

// NOTE: no ControlPlaneDO here. The directory is the PLATFORM's — it injects the
// CONTROL_PLANE binding, and a vertical that declared its own would be standing
// up a second, private directory next to the real one. `stores` lists only what
// this vertical actually owns: one Durable Object per scope.

interface Env {
  // Typed loosely rather than pulling in @cloudflare/workers-types for two
  // bindings — the adapter validates what it is handed.
  SCOPE: unknown;
  CONTROL_PLANE: unknown;
  /** Gates every `/internal` call. Unset ⇒ the platform surface 403s, by design. */
  PLATFORM_SECRET: string;
  /** Proves a request came from the router, which asserts (tenant, scope). */
  ROUTER_SECRET?: string;
  /** The identity store: delivered config, session secret, `sub → principal`. */
  IDENTITY: DurableObjectNamespace<IdentityDO>;
  /** Legacy, unread — see the ConfigDO note above. */
  CONFIG: DurableObjectNamespace<ConfigDO>;
}

/**
 * The identity DO for a TENANT. Keyed by tenant, not scope: the session secret is a
 * tenant-wide signing key, and every scope's config, owner seat and identity rows
 * are keyed by scope INSIDE it.
 */
const identityDo = (env: Env, node: { tenantId: string }) =>
  env.IDENTITY.get(env.IDENTITY.idFromName(node.tenantId));

/**
 * The identity choice the platform delivers under `substrat:auth`.
 *
 * Parsed LENIENTLY on purpose: absent or malformed means "nothing delivered",
 * never a throw. A bad delivery must not lock an instance out of its own login —
 * it should look exactly like an instance that has not been configured yet, which
 * the dashboard can fix by delivering again.
 */
const authChoice = z.object({
  mode: z.literal('oidc'),
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
  cookieDomain: z.string().min(1).optional(),
});

const hostFor = (env: Env) =>
  new CloudflareScopeHost({
    scope: env.SCOPE as never,
    controlPlane: env.CONTROL_PLANE as never,
  });

/**
 * The relying party for THIS instance, built from what the platform delivered.
 *
 * Two halves, from one round trip:
 *
 *   the CHOICE   — issuer, client id, client secret — is delivered per scope by
 *                  the platform and stored in the config DO.
 *   the SECRET   — which signs the flow and session cookies — is minted INSIDE
 *                  that DO on first use and never leaves it. Deliberately not an
 *                  env var: the platform never delivers one, and a worker binding
 *                  would be shared by every install of this serving script, so one
 *                  tenant's cookie would verify against another's.
 */
async function authProviderFor(env: Env, req: Request): Promise<AuthProvider> {
  const node = nodeFor(req, env);
  const { config, sessionSecret } = await identityDo(env, node).authWiring(node.scopeId);

  const raw = config[AUTH_CONFIG_KEY];
  let choice: z.infer<typeof authChoice> | null = null;
  if (raw) {
    try {
      choice = authChoice.safeParse(JSON.parse(raw)).data ?? null;
    } catch {
      choice = null;
    }
  }
  if (!choice) {
    throw new HTTPException(503, {
      message:
        "this instance has no identity provider configured — deliver substrat:auth with mode 'oidc'",
    });
  }
  return oidcRpAuthProvider({
    issuer: choice.issuer,
    clientId: choice.clientId,
    clientSecret: choice.clientSecret ?? '',
    sessionSecret,
    ...(choice.audience ? { audience: choice.audience } : {}),
    ...(choice.cookieDomain ? { cookieDomain: choice.cookieDomain } : {}),
  });
}

/** The (tenant, scope) the router asserted. Not a control-plane lookup. */
function nodeFor(request: Request, env: Env): { tenantId: TenantId; scopeId: ScopeId } {
  const node = readRoutedNode(request.headers, {
    ...(env.ROUTER_SECRET ? { expectedSecret: env.ROUTER_SECRET } : {}),
  });
  if (!node) throw new PermissionDenied('unrouted request: no node asserted');
  return { tenantId: node.tenantId, scopeId: node.scopeId };
}

/**
 * WHO IS ASKING, and WHERE.
 *
 * Three independent answers, and all three have to agree:
 *
 *   1. the HOSTNAME says which tenant and scope this request is for. Not a
 *      header, not a parameter — the routing table.
 *   2. the SESSION says which verified subject is making it.
 *   3. the IDENTITY DIRECTORY maps that subject to a principal IN THAT TENANT.
 *
 * Step 3 is the one that matters: authenticating proves who you are, not that
 * you belong here. A perfectly valid session for someone who is not a member of
 * this gym resolves to nothing and is refused — which is the same answer the
 * cross-tenant attacker gets in the tests, arrived at the same way.
 */
async function principalOf(
  request: Request,
  env: Env,
): Promise<{ principal: PrincipalId; tenantId: TenantId; scopeId: ScopeId }> {
  // The ROUTER says which tenant and scope, asserted in headers it signs. NOT a
  // control-plane lookup: a hosted vertical runs scope-local, with no CP in the
  // request path — `resolveHostname` here answered
  // "control plane unavailable: 'readHostname'" on the first live request.
  const node = nodeFor(request, env);

  const subject = await (await authProviderFor(env, request)).resolve(request.headers);
  if (!subject) throw new PermissionDenied('not signed in');

  // Step 3, and the one that matters. The identity DO holds this scope's
  // `sub → principal` directory: an UNCLAIMED owner seat is claimed by the first
  // subject to sign in (the TOFU install claim), and everyone else must already
  // have a seat bound to them. A perfectly valid login with no seat resolves to
  // nothing and is refused — the same answer the cross-tenant attacker gets in
  // the tests, arrived at the same way.
  const principal = await identityDo(env, node).resolvePrincipal(node.scopeId, subject.sub);
  if (!principal) {
    throw new PermissionDenied(
      `signed in as ${subject.email ?? subject.sub}, but that account has no seat in this gym`,
    );
  }
  return { principal: principal as PrincipalId, tenantId: node.tenantId, scopeId: node.scopeId };
}

const app = new Hono<{ Bindings: Env }>();

// The platform's `/internal/*` contract: provisioning, reconcile, configure.
// It also installs the error envelope, so a denial reaches a caller as a denial
// rather than as a 500.
mountPlatformSurface<Env>(app, {
  platformSecret: (env) => env.PLATFORM_SECRET,
  hostFor,
  roles: ROLES,
  // Whoever installs the vertical for a gym runs it.
  ownerRoleKey: 'admin',
  /**
   * THE CONFIG SEAM. Without it `mountPlatformSurface`'s built-in
   * `/internal/configure` answers 501 for the life of every version this app
   * ships — "this vertical stores no per-instance config" — so a scope's identity
   * choice never reaches the running worker and every request answers "not
   * configured". That was the install failure.
   *
   * Still gated by PLATFORM_SECRET: a call without it 403s before reaching here.
   */
  onConfigure: (env, b) =>
    identityDo(env, b).setScopeConfig(b.scopeId, b.entries),

  /**
   * THE OWNER SEAT. `setPendingOwner` writes both halves in one idempotent call:
   * the transient `pending_owner`, claimed and consumed by the first person to
   * sign in, and the durable `owner_of_record`, which is never consumed. Without
   * this the identity directory has no seat to hand anybody and every sign-in
   * resolves to nothing — a deploy that authenticates perfectly and admits no one.
   */
  onProvision: async (env, b) => {
    const identity = identityDo(env, b);
    await identity.setPendingOwner(b.scopeId, b.owner);
    if (b.slug) await identity.recordSite(b.scopeId, b.slug, b.name ?? b.slug);
  },

  /** Re-source a reconcile's owner from our own record, so a scope-DO wipe can be
   *  repaired without the control plane guessing who ran this gym. */
  resolveOwner: async (env, ref) =>
    (await identityDo(env, ref).getOwnerOfRecord(ref.scopeId)) as PrincipalId | null,
});

/**
 * Sign-in, callback, sign-out — the Authorization-Code + PKCE round trip, owned
 * end to end by the provider. The callback path must match what the dashboard
 * registers at the issuer: `https://<app-hostname>/api/auth/callback`.
 */
app.on(['GET', 'POST'], '/api/auth/*', async (c) =>
  (await authProviderFor(c.env, c.req.raw)).handle(c.req.raw),
);

/**
 * WHO AM I — the app shell's first call, and the only route that answers while
 * signed out. Null-shaped rather than 403, because "not signed in yet" is a normal
 * state of a login screen and not a denial.
 *
 * It was `/api/me` and could not stay there: `/me/...` is the vertical's own
 * prefix, and an auth probe registered before `mountOperations` silently shadows
 * whatever operation lands on the same path.
 *
 * `needsSetup` is what lets the UI say *claim this gym* to the first admin instead
 * of a bare *sign in* — the owner seat is unclaimed exactly once.
 */
app.get('/api/session', async (c) => {
  const node = nodeFor(c.req.raw, c.env);
  const identity = identityDo(c.env, node);
  const subject = await authProviderFor(c.env, c.req.raw)
    .then((p) => p.resolve(c.req.raw.headers))
    .catch(() => null);
  // Resolving CLAIMS the owner seat when it is unclaimed — the same call
  // `principalOf` makes, so the shell and the API can never disagree about who
  // this person is.
  const principal = subject ? await identity.resolvePrincipal(node.scopeId, subject.sub) : null;
  return c.json({
    signedIn: subject !== null,
    seated: principal !== null,
    needsSetup: await identity.needsSetup(node.scopeId),
    principal,
    email: subject?.email ?? null,
    name: subject?.name ?? null,
  });
});

/**
 * The vertical's own surface, DERIVED from the `http` declarations in
 * `src/model.ts` — the same declarations the dev harness mounts. The two
 * runtimes differ in exactly one thing: how a request becomes a scope stub.
 *
 * This was an RPC endpoint (`/op/:operation`) until the deploy made the problem
 * plain: the web app talks REST, so it could never have talked to the deployed
 * vertical. Writing the table twice by hand would have fixed that and left two
 * descriptions to keep in step; declaring it once leaves none.
 */
mountOperations(app, operations, async (c) => {
  const { principal, tenantId, scopeId } = await principalOf(c.req.raw, c.env);
  return hostFor(c.env).getScope(principal, tenantId, scopeId);
}, { basePath: '/api', knownOperations });

export default app;
