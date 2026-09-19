/**
 * `pnpm lint:model` — emit `model.json`, or check the checked-in one is current.
 *
 * The artifact is the record, not this script and not `spec/model.ts`: everything
 * downstream — the push manifest, the dashboard's Model tab, `substrat model view`
 * — reads the JSON. That is what keeps the authoring notation swappable, and what
 * keeps the model honest about what actually SHIPPED rather than what the
 * TypeScript currently says.
 *
 *   pnpm lint:model           write model.json
 *   pnpm lint:model --check   exit non-zero if it would change (CI, and the push gate)
 *
 * `--check` is the one that matters. `substrat push` reads the checked-in file, so
 * a model.json nobody re-emitted after editing the registry ships a stale answer
 * silently — the push does not compare them.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitModel } from '@substrat-run/contracts';
import { strideEntities } from '../spec/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'model.json');

// Deterministic by construction: entities and their fields are emitted sorted,
// so a reordered declaration is not a spurious diff. Trailing newline so the
// file is a well-formed text file and `git diff` has nothing to say about it.
const emitted = `${JSON.stringify(emitModel(strideEntities), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current === emitted) {
    const n = Object.keys(JSON.parse(emitted).entities).length;
    console.log(`model.json is current (${n} entities)`);
    process.exit(0);
  }
  console.error(
    existsSync(file)
      ? 'model.json is STALE — re-emit it with `pnpm lint:model` rather than hand-editing.'
      : 'model.json is MISSING — emit it with `pnpm lint:model`.',
  );
  process.exit(1);
}

writeFileSync(file, emitted);
const n = Object.keys(JSON.parse(emitted).entities).length;
console.log(`model.json written — ${n} entities`);
