import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { healthChanges, markRemoved, markWritten } from '../src/domain/health.ts';
import { deleteMeasurement, logBodyWeight } from '../src/domain/measurements.ts';
import { eraseAll } from '../src/domain/portability.ts';
import * as ops from '../src/domain/workouts.ts';

const zone = 'Australia/Brisbane';

const setup = () => {
  const db = openDb(':memory:');
  const w = ops.startWorkout(db, { now: new Date('2026-10-08T07:00:00+10:00'), timeZone: zone });
  ops.finishWorkout(db, w, new Date('2026-10-08T08:05:00+10:00'));
  ops.startWorkout(db, { now: new Date('2026-10-09T07:00:00+10:00'), timeZone: zone });
  ops.logWorkout(db, '2026-10-07', zone);
  logBodyWeight(db, 80.5, '2026-10-08');
  return { db, w };
};

const sync = (db: ReturnType<typeof openDb>) => {
  const c = healthChanges(db);
  markWritten(db, c.write);
  markRemoved(db, c.remove);
  return c;
};

test('enabling backfills finished workouts and body weight, skipping unfinished and zero-length workouts', () => {
  const { db, w } = setup();
  const weight = db.all('SELECT id FROM measurement')[0].id;
  assert.deepEqual(sync(db), {
    write: [
      { kind: 'workout', id: w, title: 'Workout', start: '2026-10-07T21:00:00.000Z', end: '2026-10-07T22:05:00.000Z' },
      { kind: 'weight', id: weight, date: '2026-10-08', kg: 80.5 },
    ],
    remove: [],
  });
  assert.deepEqual(healthChanges(db), { write: [], remove: [] });
});

test('edits rewrite the record, a moved workout keeps its clock times and deletes remove it', () => {
  const { db, w } = setup();
  sync(db);
  ops.renameWorkout(db, w, 'Push');
  ops.moveWorkout(db, w, '2026-10-06');
  assert.deepEqual(healthChanges(db).write, [{ kind: 'workout', id: w, title: 'Push', start: '2026-10-05T21:00:00.000Z', end: '2026-10-05T22:05:00.000Z' }]);
  sync(db);
  ops.deleteWorkout(db, w);
  const weight = db.all('SELECT id FROM measurement')[0].id as string;
  deleteMeasurement(db, weight);
  assert.deepEqual(sync(db), { write: [], remove: [{ id: w, kind: 'workout' }, { id: weight, kind: 'weight' }] });
  assert.deepEqual(db.all('SELECT * FROM health_record'), []);
});

test('body weight in pounds is written in kilograms', () => {
  const db = openDb(':memory:');
  ops.setSetting(db, 'weightUnit', 'lb');
  logBodyWeight(db, 180, '2026-10-08');
  assert.equal((healthChanges(db).write[0] as { kg: number }).kg, 180 * 0.45359237);
});

test('only granted kinds are written or removed', () => {
  const { db, w } = setup();
  const only = healthChanges(db, ['workout']);
  assert.deepEqual(only.write.map((r) => r.kind), ['workout']);
  markWritten(db, only.write);
  ops.deleteWorkout(db, w);
  assert.deepEqual(healthChanges(db, ['weight']).remove, []);
  assert.deepEqual(healthChanges(db, ['workout']).remove, [{ id: w, kind: 'workout' }]);
});

test('erasing forgets what was written, so a new log starts clean', () => {
  const { db } = setup();
  sync(db);
  eraseAll(db);
  assert.deepEqual(healthChanges(db), { write: [], remove: [] });
});
