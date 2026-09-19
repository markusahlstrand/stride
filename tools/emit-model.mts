/**
 * `pnpm lint:model` — emit `model.json`; `pnpm lint:model --check` — fail if it
 * is stale.
 *
 * `model.json` is the artifact of record: `substrat push` reads it off the disk
 * and carries it in the deploy manifest, which is what the dashboard's Model tab
 * renders and what `substrat model view .` draws locally. A vertical without one
 * pushes fine and records no model at all.
 *
 * It is checked in, and re-emitted here rather than at build time, for the same
 * reason the permission and migration checkpoints are: a changed table or a
 * moved parent edge then appears in the pull-request diff, where a person can
 * see it. `--check` is what keeps that true in CI.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitModel } from '@substrat-run/contracts';

import { strideEntities } from '../spec/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'model.json');

// A vertical passes no `version` — that field versions an engine's manifest shape.
const json = `${JSON.stringify(emitModel(strideEntities), null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current !== json) {
    console.error(
      `model.json is stale — run \`pnpm lint:model\` and commit the result.\n` +
        `  It is emitted from spec/model.ts, never hand-edited.`,
    );
    process.exit(1);
  }
  console.log(`model.json is up to date (${Object.keys(strideEntities).length} entities).`);
} else {
  writeFileSync(file, json);
  console.log(`wrote model.json (${Object.keys(strideEntities).length} entities).`);
}
