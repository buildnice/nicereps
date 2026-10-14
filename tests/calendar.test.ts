import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { templateId } from '../src/data/queries.ts';
import * as ops from '../src/domain/workouts.ts';

const sets = (db: ReturnType<typeof openDb>, today = '2026-10-06', past = 2) =>
  Object.fromEntries(ops.calendar(db, today, past).filter((d) => d.sets).map((d) => [d.date, d.sets]));

test('the heatmap counts completed working sets in finished workouts', () => {
  const db = openDb(':memory:');
  const [pushA] = seed(db);
  assert.deepEqual(sets(db), { '2026-09-29': 7, '2026-10-01': 6, '2026-10-04': 6, '2026-10-06': 7 });

  const [bench, press] = ops.getWorkout(db, pushA).exercises;
  const corrections = [
    [bench.sets[0].id, { type: 'normal' }, 8],
    [press.sets[2].id, { completed: true }, 9],
    [press.sets[0].id, { completed: false }, 8],
    [press.sets[1].id, { type: 'warm-up' }, 7],
  ] as const;
  for (const [id, patch, count] of corrections) {
    ops.correctSet(db, id, patch);
    assert.equal(sets(db)['2026-09-29'], count);
  }

  const open = ops.startWorkout(db, { now: new Date('2026-10-06T08:00:00+10:00'), timeZone: 'Australia/Brisbane' });
  ops.addSet(db, ops.addExercise(db, open, bench.exerciseId), { weight: 60, reps: 5, completed: true });
  assert.equal(sets(db)['2026-10-06'], 7);
  assert.equal(ops.muscleTotals(db, '2026-10-06').totals.find((t) => t.muscle === 'chest')?.sets, 4);
  ops.finishWorkout(db, open);
  assert.equal(sets(db)['2026-10-06'], 8);
  assert.deepEqual(ops.workoutsOn(db, '2026-10-06').map((w) => w.name), ['Workout', 'Push A']);
});

test('the calendar holds whole weeks of days ending the given days ahead and plans from today', () => {
  const db = openDb(':memory:');
  seed(db);
  ops.scheduleWeekday(db, 'tuesday', templateId(db, 'Push A'));
  ops.changeDay(db, '2026-12-01', templateId(db, 'Legs'));
  const days = ops.calendar(db, '2026-10-06', 12, 7);
  assert.deepEqual([days[0].date, days.at(-1)?.date, days.length], ['2026-07-22', '2026-10-13', 84]);
  assert.deepEqual(
    days.filter((d) => d.plan?.planned).map((d) => `${d.date} ${d.plan?.planned?.name}${d.plan?.done ? ' done' : ''}`),
    ['2026-10-06 Push A done', '2026-10-13 Push A'],
  );
  assert.equal(days.find((d) => d.date === '2026-09-29')?.plan, null);
  assert.equal(ops.calendar(db, '2026-10-06', 1, 56).find((d) => d.date === '2026-12-01')?.plan?.planned?.name, 'Legs');
  assert.equal(ops.calendar(db, '2026-10-06', 1).at(-1)?.date, '2026-10-06');

  assert.equal(ops.calendar(db, '2026-10-06', 1)[0].date, '2026-09-30');
  assert.throws(() => ops.calendar(db, '2026-10-06', 0), /Weeks/);
  assert.throws(() => ops.calendar(db, '2026-10-06', 1, 366), /Days ahead/);
  assert.throws(() => ops.workoutsOn(db, '2026-02-30'), /Invalid date/);
});
