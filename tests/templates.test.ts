import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { exerciseId, templateId } from '../src/data/queries.ts';
import * as ops from '../src/domain/workouts.ts';

const setup = () => {
  const db = openDb(':memory:');
  const ids = seed(db);
  return { db, ids, pushA: templateId(db, 'Push A') };
};

test('editing a template changes future uses only', () => {
  const { db, ids, pushA } = setup();
  const started = ops.startWorkout(db, { templateId: pushA });
  ops.correctSet(db, ops.getWorkout(db, started).exercises[0].sets[1].id, { reps: 8, completed: true });
  const before = [...ids, started].map((id) => ops.getWorkout(db, id));

  const plan = ops.getTemplate(db, pushA);
  const [bench, , fly] = plan.exercises;
  ops.updateTemplate(db, pushA, 'Push A heavy', [{ ...bench, sets: bench.sets.map((s) => ({ ...s, weight: 100, reps: 3 })) }, fly]);

  assert.deepEqual([...ids, started].map((id) => ops.getWorkout(db, id)), before);
  ops.finishWorkout(db, started);
  const next = ops.getWorkout(db, ops.startWorkout(db, { templateId: pushA }));
  assert.equal(next.name, 'Push A heavy');
  assert.deepEqual(next.exercises.map((e) => e.name), ['Bench Press', 'Cable Fly']);
  assert.deepEqual(next.exercises[0].sets.map((s) => [s.type, s.weight, s.targetReps]), [['warm-up', 100, 3], ['normal', 100, 3], ['normal', 100, 3], ['normal', 100, 3]]);

  ops.discardWorkout(db, next.id);
  ops.deleteTemplate(db, pushA);
  assert.deepEqual([...ids, started].map((id) => ops.getWorkout(db, id).exercises), before.map((w) => w.exercises));
  assert.equal(db.all('SELECT COUNT(*) AS n FROM template_set')[0].n, 13);
  assert.equal(db.all('SELECT COUNT(*) AS n FROM workout WHERE template_id IS NOT NULL')[0].n, 2);
  assert.throws(() => ops.startWorkout(db, { templateId: pushA }), /Not found/);
});

test('a finished workout becomes an independent template with its targets', () => {
  const { db, ids } = setup();
  const w = ops.startWorkout(db, { fromWorkoutId: ids[3] });
  const [bench, press, fly] = ops.getWorkout(db, w).exercises;
  ops.linkSuperset(db, press.id, fly.id);
  ops.correctSet(db, bench.sets[1].id, { reps: 8, targetRpe: 8, rpe: 9, rest: 200, comment: 'grind', options: true, completed: true });
  const run = ops.addExercise(db, w, exerciseId(db, 'Run'));
  ops.addSet(db, run, { distance: 5, duration: 1500 });
  assert.throws(() => ops.templateFromWorkout(db, w), /Finish/);
  ops.finishWorkout(db, w);
  assert.throws(() => ops.templateFromWorkout(db, w), /already exists/);

  const id = ops.templateFromWorkout(db, w, ' Push A + run ');
  ops.correctSet(db, bench.sets[1].id, { weight: 1 });
  const plan = ops.getTemplate(db, id);
  assert.equal(plan.name, 'Push A + run');
  assert.deepEqual(plan.exercises[0].sets[1], { type: 'normal', weight: 82.5, unit: 'kg', reps: 8, duration: null, distance: null, distanceUnit: 'km', rounds: null, recovery: null, rest: 200, targetRpe: 8, options: true });
  assert.deepEqual([plan.exercises[3].mode, plan.exercises[3].sets[0].distance, plan.exercises[3].sets[0].duration], ['distance', 5, 1500]);

  const copy = ops.getWorkout(db, ops.startWorkout(db, { templateId: id }));
  assert.ok(copy.exercises[1].superset && copy.exercises[1].superset === copy.exercises[2].superset);
  assert.deepEqual([copy.exercises[0].sets[1].rpe, copy.exercises[0].sets[1].comment, copy.exercises[0].sets[1].completed], [null, null, false]);

  ops.updateTemplate(db, id, plan.name, plan.exercises.filter((_, i) => i !== 2));
  assert.equal(ops.getTemplate(db, id).exercises[1].superset, null);
});

test('template names are required and unique', () => {
  const { db, pushA } = setup();
  assert.throws(() => ops.createTemplate(db, '  ', []), /name is required/);
  assert.throws(() => ops.updateTemplate(db, pushA, 'Legs', []), /already exists/);
  assert.throws(() => ops.updateTemplate(db, pushA, 'x', [{ exerciseId: exerciseId(db, 'Run'), sets: [{ type: 'normal', weight: -1, reps: 0 }] }]), /non-negative/);
  assert.equal(ops.getTemplate(db, pushA).exercises.length, 3);
  ops.updateTemplate(db, pushA, ' Push A ', []);
  assert.deepEqual(ops.listTemplates(db).map((t) => [t.name, t.count]), [['Legs', 2], ['Pull B', 2], ['Push A', 0]]);
});

test('template reps become targets: a blank set needs reps to be ticked, a typed 0 is kept, and saving can drop weight or reps', () => {
  const { db, pushA } = setup();
  const w = ops.startWorkout(db, { templateId: pushA });
  const [a, b, c] = ops.getWorkout(db, w).exercises[0].sets;
  assert.deepEqual([a.reps, a.targetReps, b.targetReps], [0, 10, 8]);
  const pick = (s: { reps: number; repsEntered?: boolean; completed: boolean }) => [s.reps, s.repsEntered, s.completed];
  assert.equal(a.repsEntered, false);
  assert.throws(() => ops.correctSet(db, b.id, { completed: true }), /Enter reps/);
  ops.correctSet(db, b.id, { reps: 8, completed: true });
  ops.correctSet(db, c.id, { reps: 6 });
  ops.correctSet(db, c.id, { completed: true });
  const added = ops.addSet(db, ops.getWorkout(db, w).exercises[0].id);
  const sets = ops.getWorkout(db, w).exercises[0].sets;
  assert.deepEqual(sets.map((s) => [s.reps, s.targetReps]).slice(1, 3), [[8, 8], [6, 8]]);
  assert.deepEqual([sets.at(-1)!.reps, sets.at(-1)!.targetReps], [0, 8]);
  assert.throws(() => ops.correctSet(db, added, { targetReps: 1.5 }), /Weight and reps/);
  assert.throws(() => ops.correctSet(db, added, { completed: true }), /Enter reps/);
  ops.correctSet(db, added, { reps: 0, completed: true });
  assert.deepEqual(pick(ops.getWorkout(db, w).exercises[0].sets.at(-1)!), [0, true, true]);
  ops.correctSet(db, added, { completed: false });
  assert.deepEqual(pick(ops.getWorkout(db, w).exercises[0].sets.at(-1)!), [0, true, false]);
  ops.correctSet(db, a.id, { fields: 'rpe' });
  ops.correctSet(db, b.id, { fields: '' });
  ops.finishWorkout(db, w);
  const kept = ops.getTemplate(db, ops.templateFromWorkout(db, w, 'Kept')).exercises[0].sets;
  assert.deepEqual(kept.map((s) => s.reps).slice(0, 3), [10, 8, 6]);
  assert.deepEqual(kept.map((s) => s.options).slice(0, 2), [true, false]);
  const light = ops.getTemplate(db, ops.templateFromWorkout(db, w, 'Light', { weight: false, reps: true })).exercises[0].sets;
  assert.deepEqual([light[2].weight, light[2].reps], [0, 6]);
  const heavy = ops.getTemplate(db, ops.templateFromWorkout(db, w, 'Heavy', { weight: true, reps: false })).exercises[0].sets;
  assert.deepEqual([heavy[2].weight > 0, heavy[2].reps], [true, 0]);
});
