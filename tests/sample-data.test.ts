import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { generate } from '../scripts/sample-data.ts';
import { applyImport, exportArchive, readImport } from '../src/domain/portability.ts';

test('the App Review sample history exports and imports cleanly into an empty app', async () => {
  const db = openDb(':memory:');
  generate(db, '2026-10-27', 'America/Los_Angeles');
  const chunks: Uint8Array[] = [];
  await exportArchive(db, () => null, (chunk) => chunks.push(chunk));
  const fresh = openDb(':memory:');
  const result = applyImport(fresh, readImport(fresh, [Buffer.concat(chunks)], 'America/Los_Angeles'), 'skip');
  assert.deepEqual(result.errors, []);
  const [w] = fresh.all('SELECT COUNT(*) n, MIN(date) first, MAX(date) last, COUNT(DISTINCT name) names, SUM(finished_at IS NULL) open FROM workout');
  assert.ok((w.n as number) > 70 && (w.names as number) >= 8 && w.open === 0);
  assert.ok((w.first as string) <= '2026-06-05' && (w.last as string) >= '2026-10-20' && (w.last as string) < '2026-10-27');
  assert.equal(result.counts.workout_set.new, db.all('SELECT COUNT(*) n FROM workout_set')[0].n);
});
