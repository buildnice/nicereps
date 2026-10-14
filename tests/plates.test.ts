import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { exerciseId } from '../src/data/queries.ts';
import { kitDefaults, loadPlates } from '../src/domain/plates.ts';
import { convert } from '../src/domain/rules.ts';
import * as ops from '../src/domain/workouts.ts';

const { kg, lb } = kitDefaults;

test('plates per side match fixtures, rounding to the nearest loadable weight', () => {
  const cases: [number, typeof kg, number, number[]][] = [
    [100, kg, 100, [25, 15]],
    [142.5, kg, 142.5, [25, 25, 10, 1.25]],
    [61, kg, 60, [20]],
    [62, kg, 62.5, [20, 1.25]],
    [21.25, kg, 20, []],
    [15, kg, 20, []],
    [0, kg, 20, []],
    [225, lb, 225, [45, 45]],
    [315, lb, 315, [45, 45, 45]],
    [136, lb, 135, [45]],
    [138, lb, 140, [45, 2.5]],
    [80, { bar: 20, plates: [20, 15] }, 80, [15, 15]],
    [100, { bar: 20, plates: [] }, 20, []],
  ];
  assert.equal(loadPlates(1e9, kg), null);
  assert.equal(loadPlates(2521, { bar: 20, plates: [25] }), null);
  assert.deepEqual(loadPlates(2520, { bar: 20, plates: [25] })?.side.length, 50);
  for (const [weight, kit, loaded, side] of cases) assert.deepEqual(loadPlates(weight, kit), { weight: loaded, side }, `${weight} on ${kit.bar}`);
});

test('an exercise bar overrides the Settings bar and gives any exercise plates', () => {
  const db = openDb(':memory:');
  seed(db);
  const w = ops.startWorkout(db, {});
  const bar = (name: string) => ops.exerciseKit(db, 'kg', ops.listExercises(db).find((e) => e.name === name)!)?.bar;
  assert.equal(bar('Close-Grip EZ Bar Curl'), 20);
  assert.equal(bar('Back Squat'), undefined);
  ops.setBar(db, exerciseId(db, 'Trap Bar Deadlift'), 25, 'kg');
  ops.setBar(db, exerciseId(db, 'Back Squat'), 22, 'lb');
  assert.equal(bar('Trap Bar Deadlift'), 25);
  assert.equal(bar('Back Squat'), convert(22, 'lb', 'kg'));
  ops.setBar(db, exerciseId(db, 'Back Squat'), null, 'kg');
  assert.equal(ops.exerciseKit(db, 'kg', ops.listExercises(db, 'Back Squat')[0]), undefined);
  assert.throws(() => ops.setBar(db, exerciseId(db, 'Back Squat'), -1, 'kg'), /Bar weight must be/);
  assert.throws(() => ops.setBar(db, exerciseId(db, 'Back Squat'), 0, 'kg'), /Bar weight must be above 0/);
  assert.throws(() => ops.setBar(db, exerciseId(db, 'Plank'), 20, 'kg'), /Only weight × reps/);
  for (const [bar, unit] of [[20, null], [null, 'kg'], [0, 'kg'], [20, 'st']]) assert.throws(() => db.run('UPDATE exercise SET bar = ?, bar_unit = ? WHERE id = ?', [bar, unit, exerciseId(db, 'Back Squat')]), /CHECK/);
});

test('bar and plate settings accept only listed values per unit', () => {
  const db = openDb(':memory:');
  assert.deepEqual(ops.kit(db, 'kg'), kg);
  ops.setSetting(db, 'kgPlates', '20,10,1.25');
  ops.setSetting(db, 'kgBar', '15');
  assert.deepEqual(ops.kit(db, 'kg'), { bar: 15, plates: [20, 10, 1.25] });
  assert.deepEqual(ops.kit(db, 'lb'), lb);
  ops.setSetting(db, 'kgPlates', '');
  assert.deepEqual(ops.kit(db, 'kg').plates, []);
  assert.throws(() => ops.setSetting(db, 'kgPlates', '20,3'), /kg plates must be a comma-separated list of: 25, 20/);
  assert.throws(() => ops.setSetting(db, 'kgPlates', '20,20'), /kg plates must be/);
  assert.throws(() => ops.setSetting(db, 'lbBar', '20'), /lb bar must be one of: 45, 35, 25, 15/);
});
