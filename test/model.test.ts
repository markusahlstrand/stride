import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { primaryKeyOf, type EntityDef } from '@substrat-run/contracts';
import { z } from '@substrat-run/contracts';

import { strideMigrations } from '../src/migrations.js';
import { strideEntities } from '../spec/model.js';

// ============================================================================
// The registry and the migrations, held to each other.
//
// `spec/model.ts` is a SECOND description of rows that `src/migrations.ts`
// already creates, and a second description is worthless unless something makes
// it agree with the first. So this applies every migration to a real SQLite
// database — ALTERs and all, which is the only way to know what the tables
// actually look like after ten of them — and compares it column by column.
//
// It bites in BOTH directions: a field declared for a column that does not
// exist, and a table a migration added that the model never heard of. The
// second is the one that would otherwise rot quietly — model.json would keep
// emitting, keep passing --check, and keep describing last month's schema.
// ============================================================================

/** Every migration applied in order — what a fresh scope's database looks like. */
function migratedSchema() {
  const db = new Database(':memory:');
  for (const m of strideMigrations) db.exec(m.sql);
  return db;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

/**
 * Whether a column holds a NUMBER or text — the whole of what the declaration
 * says, because every field in `spec/model.ts` is a `z.string()` or a
 * `z.number()`, nullable or not.
 *
 * Deliberately NOT SQLite's affinity table. Affinity answers a different
 * question: `DATETIME` and `DECIMAL` both take NUMERIC affinity, and in this
 * schema both would hold ISO text against a `z.string()` — rule 5 in AGENTS.md
 * requires timestamps be stored as text and money as decimal strings. Reading
 * affinity as "holds a number" would fail the gate on exactly the rows the
 * codebase mandates.
 *
 * So the recognised set is the one the migrations actually use, and anything
 * else THROWS rather than being guessed into a bucket. A column type nobody has
 * thought about is a question for whoever adds it, and a gate that quietly
 * answers it on their behalf is the pass-that-checked-nothing this file exists
 * to prevent.
 */
function holdsNumber(declaredType: string, where: string): boolean {
  const t = declaredType.toUpperCase();
  if (t === 'TEXT') return false;
  if (t === 'INTEGER') return true;
  throw new Error(
    `${where}: no rule for the declared type ${declaredType || '(none)'}. ` +
      `Decide whether it holds a number or text and extend holdsNumber — do not assume.`,
  );
}

const db = migratedSchema();

const tablesInDb = (db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'train_%' ORDER BY name")
  .all() as { name: string }[]).map((r) => r.name);

const entities = Object.entries(strideEntities) as [string, EntityDef][];

describe('the entity registry describes the migrated schema', () => {
  it('declares every table the migrations create, and no others', () => {
    expect([...entities.map(([, e]) => e.table)].sort()).toEqual(tablesInDb);
  });

  for (const [name, entity] of entities) {
    describe(name, () => {
      const columns = db.prepare(`PRAGMA table_info(${entity.table})`).all() as ColumnInfo[];
      const shape = (entity.fields as z.ZodObject<z.ZodRawShape>).shape as Record<string, z.ZodType>;

      it('has exactly the declared fields', () => {
        expect(columns.map((c) => c.name).sort()).toEqual(Object.keys(shape).sort());
      });

      it('agrees about what may be null', () => {
        for (const col of columns) {
          const field = shape[col.name];
          if (!field) continue; // the test above owns that failure
          // A TEXT primary key is nullable in SQLite and must not be: the DDL
          // emitter writes `TEXT PRIMARY KEY NOT NULL` for exactly this reason,
          // so the declaration states the intent rather than the storage quirk.
          const nullableInSql = col.notnull === 0 && col.pk === 0;
          expect(
            { column: col.name, nullable: field.safeParse(null).success },
            `${entity.table}.${col.name}`,
          ).toEqual({ column: col.name, nullable: nullableInSql });
        }
      });

      it('agrees about what a column holds', () => {
        for (const col of columns) {
          const field = shape[col.name];
          if (!field) continue; // the test above owns that failure
          // Asked the same way nullability is, by offering the field a value
          // rather than reading Zod's internals: a number field accepts 0 and a
          // string field does not, through `.nullable()` and whatever else the
          // declaration wraps it in. Without this a `z.string()` on an INTEGER
          // column passes every other assertion here and `model.json` publishes
          // the wrong type with the gate green — and 21 of these columns are
          // integers, so the mistake is available to make.
          const declared = field.safeParse(0).success ? 'number' : 'text';
          const inSql = holdsNumber(col.type, `${entity.table}.${col.name}`) ? 'number' : 'text';
          expect({ column: col.name, holds: declared }, `${entity.table}.${col.name}`).toEqual({
            column: col.name,
            holds: inSql,
          });
        }
      });

      it('agrees about the primary key', () => {
        const inSql = columns
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => c.name);
        expect(primaryKeyOf(name, entity)).toEqual(inSql);
      });

      const key = entity.key;
      if (key) {
        it('declares a key SQLite actually enforces', () => {
          const uniques = (db.prepare(`PRAGMA index_list(${entity.table})`).all() as {
            name: string;
            unique: number;
            origin: string;
          }[])
            .filter((i) => i.unique && i.origin !== 'pk')
            .map((i) =>
              (db.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[])
                .map((c) => c.name)
                .sort()
                .join(','),
            );
          expect(uniques).toContain([...key].sort().join(','));
        });
      }
    });
  }
});
