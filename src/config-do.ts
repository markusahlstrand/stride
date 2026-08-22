import { DurableObject } from 'cloudflare:workers';

// ============================================================================
// PER-INSTANCE CONFIG — a HARNESS store, not module code.
//
// Config is not domain data. It must survive a scope-DO storage wipe, so it
// lives outside the scope DO entirely: one Durable Object per TENANT, rows keyed
// by scope.
//
// The table is deliberately named `scope_config (scope_id, key, value)` — the
// same shape as `IdentityDO` in @substrat-run/vertical-auth — so this can be
// swapped for the full identity DO later without migrating a single row.
// ============================================================================

/**
 * The key the platform delivers a scope's identity choice under.
 *
 * Exported from HERE rather than from `worker.ts` because workerd requires every
 * named export of the entry module to be a handler or a Durable Object class — a
 * plain constant there fails to boot.
 */
export const AUTH_CONFIG_KEY = 'substrat:auth';

export class ConfigDO extends DurableObject<Record<string, never>> {
  private ready = false;

  private init(): void {
    if (this.ready) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS scope_config (
         scope_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
         PRIMARY KEY (scope_id, key))`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    this.ready = true;
  }

  /**
   * Key-by-key upsert, so a partial delivery composes rather than replacing what
   * is already there — and so the reconcile sweep can re-deliver safely.
   */
  async setScopeConfig(
    scopeId: string,
    entries: Array<{ key: string; value: string }>,
  ): Promise<void> {
    this.init();
    for (const { key, value } of entries) {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO scope_config (scope_id, key, value) VALUES (?, ?, ?)',
        scopeId,
        key,
        value,
      );
    }
  }

  /**
   * Delivered config plus this tenant's session-signing secret, in ONE round trip.
   *
   * The secret is minted HERE, on first use, and never leaves. It is deliberately
   * not an env var: the platform never delivers one, and a worker binding would
   * be shared by every install of this serving script — one tenant's cookie would
   * verify against another's.
   */
  async authWiring(
    scopeId: string,
  ): Promise<{ config: Record<string, string>; sessionSecret: string }> {
    this.init();
    const config: Record<string, string> = {};
    for (const row of this.ctx.storage.sql.exec(
      'SELECT key, value FROM scope_config WHERE scope_id = ?',
      scopeId,
    )) {
      config[row.key as string] = row.value as string;
    }

    let secret = (
      [...this.ctx.storage.sql.exec("SELECT value FROM config WHERE key = 'session_secret'")][0] as
        | { value: string }
        | undefined
    )?.value;
    if (!secret) {
      // Web Crypto only — never a `node:` import, never a hand-rolled generator.
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      secret = btoa(String.fromCharCode(...bytes));
      this.ctx.storage.sql.exec(
        "INSERT INTO config (key, value) VALUES ('session_secret', ?)",
        secret,
      );
    }
    return { config, sessionSecret: secret };
  }
}
