import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { exerciseId, templateId } from '../src/data/queries.ts';
import { addMeasurement, editMeasurement } from '../src/domain/measurements.ts';
import { convert } from '../src/domain/rules.ts';
import * as ops from '../src/domain/workouts.ts';

const stored = (db: ReturnType<typeof openDb>) =>
  ['workout_set', 'template_set', 'measurement'].map((table) => db.all(`SELECT ${table === 'measurement' ? 'id, value' : 'weight'} AS value, unit FROM ${table} ORDER BY 1, 2`).map((r) => ({ ...r })));

test('switching units and back leaves stored values bit-identical', () => {
  const db = openDb(':memory:');
  seed(db);
  const w = ops.startWorkout(db, {});
  ops.addSet(db, ops.addExercise(db, w, exerciseId(db, 'Back Squat')), { weight: 0.1 + 0.2, reps: 5 });
  const weight = addMeasurement(db, { preset: 'body-weight' }, 81.23456789, '2026-10-01');
  addMeasurement(db, { preset: 'waist' }, 83.3333333, '2026-10-01');
  const before = stored(db);

  ops.setSetting(db, 'weightUnit', 'lb');
  ops.setSetting(db, 'lengthUnit', 'in');
  editMeasurement(db, weight.id, undefined, '2026-10-02');
  ops.updateTemplate(db, templateId(db, 'Push A'), 'Push A', ops.getTemplate(db, templateId(db, 'Push A')).exercises);
  ops.setSetting(db, 'weightUnit', 'kg');
  ops.setSetting(db, 'lengthUnit', 'cm');

  assert.deepEqual(stored(db), before);
  assert.deepEqual(stored(db)[2].find((m) => m.id === weight.id), { id: weight.id, value: 81.23456789, unit: 'kg' });
});

test('new entries keep the unit they were typed in', () => {
  const db = openDb(':memory:');
  ops.setSetting(db, 'weightUnit', 'lb');
  ops.setSetting(db, 'lengthUnit', 'in');
  const we = ops.addExercise(db, ops.startWorkout(db, {}), ops.createExercise(db, 'Press', []));
  const set = ops.addSet(db, we, { weight: 135, reps: 5 });
  ops.setSetting(db, 'weightUnit', 'kg');
  assert.equal(ops.getWorkout(db, ops.unfinishedWorkouts(db)[0].id as string).exercises[0].sets[0].unit, 'lb');
  assert.equal(ops.addSet(db, we) && ops.getWorkout(db, ops.unfinishedWorkouts(db)[0].id as string).exercises[0].sets[1].unit, 'lb');
  ops.correctSet(db, set, { reps: 6 });
  assert.deepEqual(db.all('SELECT weight, unit FROM workout_set WHERE id = ?', [set]).map((r) => ({ ...r })), [{ weight: 135, unit: 'lb' }]);
  const waist = addMeasurement(db, { preset: 'waist' }, 32, '2026-10-01');
  editMeasurement(db, waist.id, 33, '2026-10-01');
  assert.deepEqual(db.all('SELECT value, unit FROM measurement').map((r) => ({ ...r })), [{ value: 33, unit: 'in' }]);
  assert.throws(() => ops.setSetting(db, 'weightUnit', 'st'), /Weight unit must be one of: kg, lb/);
  assert.throws(() => ops.setSetting(db, 'lengthUnit', 'toString'), /Length unit must be one of/);
});

test('records compare across units and display converts to one decimal', () => {
  const db = openDb(':memory:');
  const w = ops.startWorkout(db, {});
  const we = ops.addExercise(db, w, ops.createExercise(db, 'Press', []));
  ops.addSet(db, we, { weight: 100, unit: 'kg', reps: 5, completed: true });
  const heavy = ops.addSet(db, we, { weight: 225, unit: 'lb', reps: 5, completed: true });
  ops.finishWorkout(db, w);
  const p = ops.progress(db, 'Press');
  assert.equal(p.weight?.set.id, heavy);
  assert.deepEqual(p.reps.map((r) => [r.set.weight, r.set.unit]), [[225, 'lb'], [100, 'kg']]);
  assert.deepEqual([convert(100, 'kg', 'lb'), convert(225, 'lb', 'kg'), convert(82.5, 'kg', 'kg'), convert(90, 'cm', 'in')], [220.5, 102.1, 82.5, 35.4]);
});

test('distance keeps its typed unit and stored precision across km/mi switches', () => {
  const db = openDb(':memory:');
  const we = ops.addExercise(db, ops.startWorkout(db, {}), ops.createExercise(db, 'Row', [], { mode: 'distance' }));
  const km = ops.addSet(db, we, { distance: 0.1 + 0.2, duration: 120 });
  ops.setSetting(db, 'distanceUnit', 'mi');
  const mi = ops.addSet(db, we, { distance: 3.12, distanceUnit: 'mi' });
  ops.correctSet(db, km, { duration: 121 });
  ops.setSetting(db, 'distanceUnit', 'km');
  assert.deepEqual(db.all('SELECT id, distance, distance_unit FROM workout_set ORDER BY position').map((r) => ({ ...r })), [
    { id: km, distance: 0.1 + 0.2, distance_unit: 'km' },
    { id: mi, distance: 3.12, distance_unit: 'mi' },
  ]);
  assert.equal(ops.addSet(db, we) && ops.getWorkout(db, ops.unfinishedWorkouts(db)[0].id as string).exercises[0].sets[2].distanceUnit, 'mi');
  assert.deepEqual([convert(5, 'km', 'mi'), convert(3.12, 'mi', 'km'), convert(3.12, 'mi', 'mi')], [3.1, 5, 3.12]);
  assert.throws(() => ops.setSetting(db, 'distanceUnit', 'm'), /Distance unit must be one of: km, mi/);
});
