---
'stride': minor
---

The entity model, declared once — and the seven permission edges start being checked.

`entityRelations` was seven hand-written pairs of bare strings, and nothing checked them
against anything. A typo'd `parentType` parsed cleanly and produced an edge permission never
flows along: no error, no denial to read, the grant simply never reaches the child. With a
depth-3 walk (`session → workorder → trainee → coach`) and a coach's whole reach riding on
two of those edges, that was the quietest way this app could break.

`spec/model.ts` now declares the eighteen tables as an entity registry — the table, the row
shape, the key, and where permission may flow. `manifestEntities` composes the manifest half
from it: the four local edges are derived from each child's own `parents`, and the three that
cross into engine-workorder are declared as `relations` with `engines: [workorderEntities]`,
so both ends of those are checked against the engine's own registry. All seven are compile
errors when misspelled now, including the foreign ones — which is new, and is why the
`foreignChildOf` split upstream had nothing left to say.

The derived set was compared pair-by-pair against the seven that were there before: identical,
none missing, none extra. The permission digest is unchanged at
`fc91fc576dc8db4fbbb4cfa8d29a2c1b`, so the reviewable surface did not move.

`model.json` is emitted beside `package.json` and checked in, which is what `substrat push`
carries and what the dashboard's Model tab reads — it reported "no entity model" until now.
`pnpm lint:model` emits it and `--check` gates it, and that gate matters: push reads the
checked-in file and never compares it to the TypeScript, so a registry edited without
re-emitting would ship a stale model in silence.

Migrations did not move and are not derived from this. Upstream is explicit that making the
model the source of the DDL is a separate open question; the registry is a prerequisite either
way. `migrations.ts` stays append-only and authoritative, and no new `SqlMigration` is in here.

One fidelity gap worth knowing before anything starts deriving DDL from this: `key` holds one
natural key, so `train_trainees` declares `number` and its separate unique index on
`principal_id` is not expressed. Harmless while migrations are hand-written, and a real gap
the day they are not.
