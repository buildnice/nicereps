import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { templateId } from '../src/data/queries.ts';
import * as ops from '../src/domain/workouts.ts';

const setup = () => {
  const db = openDb(':memory:');
  seed(db);
  const [push, pull, legs] = ['Push A', 'Pull B', 'Legs'].map((name) => templateId(db, name));
  ops.scheduleWeekday(db, 'monday', push);
  ops.scheduleWeekday(db, 'thursday', legs);
  return { db, push, pull, legs };
};
const plan = (db: ReturnType<typeof openDb>, from = '2026-10-12', days = 21) =>
  ops.plannedDays(db, from, days).map((d) => `${d.date} ${d.planned?.name ?? '-'}${d.changed ? ' *' : ''}`);

test('a one-off change affects only its date', () => {
  const { db, pull, legs } = setup();
  const before = plan(db);
  assert.deepEqual(before.filter((d) => !d.endsWith('-')), [
    '2026-10-12 Push A',
    '2026-10-15 Legs',
    '2026-10-19 Push A',
    '2026-10-22 Legs',
    '2026-10-26 Push A',
    '2026-10-29 Legs',
  ]);

  ops.changeDay(db, '2026-10-19', pull);
  ops.changeDay(db, '2026-10-22', null);
  ops.changeDay(db, '2026-10-24', legs);
  const after = plan(db);
  const changed = after.flatMap((d, i) => (d === before[i] ? [] : [d]));
  assert.deepEqual(changed, ['2026-10-19 Pull B *', '2026-10-22 - *', '2026-10-24 Legs *']);
  assert.deepEqual(ops.plannedDays(db, '2026-10-19', 1)[0].repeat?.name, 'Push A');

  ops.resetDay(db, '2026-10-19');
  ops.resetDay(db, '2026-10-22');
  ops.resetDay(db, '2026-10-24');
  assert.deepEqual(plan(db), before);
});

test('weekly changes keep one-off changes, and deleting a template clears its plans', () => {
  const { db, push, pull, legs } = setup();
  ops.changeDay(db, '2026-10-19', pull);
  ops.scheduleWeekday(db, 'monday', legs);
  ops.scheduleWeekday(db, 'thursday', null);
  assert.deepEqual(plan(db, '2026-10-12', 14).filter((d) => !d.endsWith('-')), ['2026-10-12 Legs', '2026-10-19 Pull B *']);

  ops.scheduleWeekday(db, 'monday', push);
  ops.deleteTemplate(db, pull);
  assert.deepEqual(plan(db, '2026-10-12', 14).filter((d) => !d.endsWith('-')), ['2026-10-12 Push A', '2026-10-19 - *']);
});

test('a planned day is done once any workout is finished that day', () => {
  const { db } = setup();
  const day = () => ops.plannedDays(db, '2026-10-12', 1)[0];
  const id = ops.startWorkout(db, { now: new Date('2026-10-12T07:00:00+10:00'), timeZone: 'Australia/Brisbane' });
  assert.equal(day().done, false);
  ops.finishWorkout(db, id);
  assert.equal(day().done, true);
});

test('schedule input is validated', () => {
  const { db, push } = setup();
  assert.throws(() => ops.scheduleWeekday(db, 'mon', push), /Weekday/);
  assert.throws(() => ops.scheduleWeekday(db, 'monday', 'missing'), /Not found/);
  assert.throws(() => ops.changeDay(db, '2026-02-30', push), /Invalid date/);
  assert.throws(() => ops.changeDay(db, '2026-10-19', 'missing'), /Not found/);
  assert.throws(() => ops.plannedDays(db, 'today', 7), /Invalid date/);
  assert.throws(() => ops.plannedDays(db, '2026-10-12', 0), /Days/);
  assert.equal(plan(db).length, 21);
});
