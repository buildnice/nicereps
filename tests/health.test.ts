import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { forgetHealth, healthChanges, markRemoved, markWritten, readWeights } from '../src/domain/health.ts';
import { bodyWeights, deleteMeasurement, logBodyWeight } from '../src/domain/measurements.ts';
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

test('a workout moved across a daylight saving change keeps its wall-clock times', () => {
  const db = openDb(':memory:');
  const zone = 'America/New_York';
  const w = ops.startWorkout(db, { now: new Date('2025-11-03T07:00:00-05:00'), timeZone: zone });
  ops.finishWorkout(db, w, new Date('2025-11-03T08:00:00.500-05:00'));
  ops.moveWorkout(db, w, '2025-10-31');
  assert.deepEqual(healthChanges(db).write[0], { kind: 'workout', id: w, title: 'Workout', start: '2025-10-31T11:00:00.000Z', end: '2025-10-31T12:00:00.500Z' });
});

test('a workout with an unreadable time zone is written unmoved', () => {
  const { db, w } = setup();
  db.run("UPDATE workout SET time_zone = 'Bogus/Zone' WHERE id = ?", [w]);
  assert.equal((healthChanges(db).write[0] as { start: string }).start, '2026-10-07T21:00:00.000Z');
});

test('turning sync off forgets what was written, so turning it on rewrites everything', () => {
  const { db } = setup();
  const first = sync(db);
  forgetHealth(db);
  assert.deepEqual(healthChanges(db), first);
});

test('reading adds the earliest weight of each date that has none, keeps existing entries and never writes them back', () => {
  const { db } = setup();
  const samples = [
    { id: 'hc-1', at: '2026-10-08T21:30:00Z', kg: 79.9 }, // 2026-10-09 07:30 in Brisbane
    { id: 'hc-2', at: '2026-10-08T22:30:00Z', kg: 80.4 }, // later the same morning
    { id: 'hc-3', at: '2026-10-07T22:00:00Z', kg: 81 }, // 2026-10-08, already logged in nicereps
    { id: 'hc-4', at: '2026-10-09T22:00:00Z', kg: 0 },
  ];
  assert.equal(readWeights(db, samples, zone), 1);
  assert.deepEqual(bodyWeights(db).map((e) => [e.date, e.value]).sort(), [['2026-10-08', 80.5], ['2026-10-09', 79.9]]);
  assert.deepEqual(healthChanges(db).write.map((r) => (r.kind === 'weight' ? r.date : r.kind)), ['workout', '2026-10-08']);
  assert.equal(readWeights(db, samples, zone), 0);
});

test('a weight read from the store stays deleted, is read in the weight unit, and erase reads it again', () => {
  const db = openDb(':memory:');
  ops.setSetting(db, 'weightUnit', 'lb');
  const sample = [{ id: 'hk-1', at: '2026-10-08T21:30:00Z', kg: 80 }];
  readWeights(db, sample, zone);
  assert.deepEqual(bodyWeights(db).map((e) => [e.value, e.unit]), [[176.4, 'lb']]);
  deleteMeasurement(db, bodyWeights(db)[0].id);
  forgetHealth(db);
  assert.equal(readWeights(db, sample, zone), 0);
  eraseAll(db);
  assert.equal(readWeights(db, sample, zone), 1);
});

test('reading takes the earliest sample whatever the order, rounds it, and marks an equal entry as read', () => {
  const db = openDb(':memory:');
  logBodyWeight(db, 80, '2026-10-07');
  markWritten(db, healthChanges(db).write);
  const samples = [
    { id: 'hc-2', at: '2026-10-08T22:30:00Z', kg: 80.4 },
    { id: 'hc-1', at: '2026-10-08T21:30:00Z', kg: 72.57475 },
    { id: 'hc-3', at: '2026-10-06T22:00:00Z', kg: 80 }, // 2026-10-07: the same weight, as after an export and import
  ];
  assert.equal(readWeights(db, samples, zone), 1);
  assert.deepEqual(bodyWeights(db).map((e) => [e.date, e.value]).sort(), [['2026-10-07', 80], ['2026-10-09', 72.6]]);
  assert.deepEqual(healthChanges(db), { write: [], remove: [{ id: bodyWeights(db).find((e) => e.date === '2026-10-07')!.id, kind: 'weight' }] });
});
