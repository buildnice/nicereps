import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { exerciseId } from '../src/data/queries.ts';
import { migrations } from '../src/data/schema.ts';
import { pace, supersetBlocks } from '../src/domain/rules.ts';
import * as ops from '../src/domain/workouts.ts';

const setup = () => {
  const db = openDb(':memory:');
  const ids = seed(db);
  return { db, ids, id: (name: string) => exerciseId(db, name) };
};

const positions = (db: ReturnType<typeof openDb>, table: string, parent: string, id: string) =>
  db.all(`SELECT position FROM ${table} WHERE ${parent} = ? ORDER BY position`, [id]).map((r) => r.position);

test('one workout mixes all five modes and keeps every field', () => {
  const { db, id } = setup();
  const w = ops.startWorkout(db, { now: new Date('2026-10-08T07:00:00+10:00'), timeZone: 'Australia/Brisbane' });
  const [bench, plank, run, bike, mobility] = ['Bench Press', 'Plank', 'Run', 'Bike Sprints', 'Mobility Flow'].map((name) => ops.addExercise(db, w, id(name)));
  ops.addSet(db, bench, { weight: 60, reps: 10, type: 'warm-up' });
  ops.addSet(db, bench, { weight: 85, reps: 8, targetRpe: 8, rpe: 8.5, rest: 180, comment: '  paused  ', completed: true });
  ops.addSet(db, plank, { duration: 60, completed: true });
  ops.addSet(db, run, { distance: 5, duration: 1500, completed: true });
  ops.addSet(db, bike, { rounds: 8, duration: 20, recovery: 10, completed: true });
  ops.addSet(db, mobility, { comment: 'hips', completed: true });
  ops.noteWorkout(db, w, ' felt good ');
  ops.noteExercise(db, bench, 'elbows in');
  ops.finishWorkout(db, w);

  const done = ops.getWorkout(db, w);
  assert.equal(done.note, 'felt good');
  assert.deepEqual(done.exercises.map((e) => e.mode), ['reps', 'duration', 'distance', 'interval', 'check']);
  assert.equal(done.exercises[0].note, 'elbows in');
  assert.deepEqual(
    { ...done.exercises[0].sets[1], id: undefined },
    { id: undefined, type: 'normal', weight: 85, unit: 'kg', reps: 8, targetReps: 10, completed: true, duration: null, distance: null, distanceUnit: 'km', rounds: null, recovery: null, rest: 180, targetRpe: 8, rpe: 8.5, comment: 'paused', options: null, fields: null },
  );
  assert.deepEqual(done.exercises.slice(1).map((e) => e.sets[0].completed), [true, true, true, true]);
  assert.equal(pace(1500, 5), 300);
  assert.equal(pace(1500, 0), null);
  assert.equal(Math.round(pace(1500, 3.12, 'mi', 'km')!), 299);
  assert.equal(ops.muscleTotals(db, '2026-10-08').totals.find((t) => t.muscle === 'abdominals')?.sets, 1);
});

test('step 2 database migrates with its data intact', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'step2.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`${(migrations[0] as string[]).join(';\n')};
    INSERT INTO exercise VALUES ('e1', 'Bench Press');
    INSERT INTO workout VALUES ('w1', NULL, 'Push', '2026-10-01', 'UTC', '2026-10-01T07:00:00Z', NULL);
    INSERT INTO workout_exercise VALUES ('we1', 'w1', 'e1', 0);
    INSERT INTO workout_set VALUES ('s1', 'we1', 0, 'normal', 80, 8, 1);
    INSERT INTO template VALUES ('t1', 'Push');
    INSERT INTO template_exercise VALUES ('te1', 't1', 'e1', 0);
    INSERT INTO template_set VALUES ('ts1', 'te1', 0, 'normal', 80, 8);
    PRAGMA user_version = 1;`);
  legacy.close();

  const db = openDb(file);
  assert.equal(db.all('PRAGMA user_version')[0].user_version, migrations.length);
  const w = ops.getWorkout(db, 'w1');
  assert.deepEqual([w.exercises[0].mode, w.exercises[0].rest, w.exercises[0].superset, w.note], ['reps', 120, null, null]);
  assert.deepEqual(w.exercises[0].sets[0], {
    id: 's1', type: 'normal', weight: 80, unit: 'kg', reps: 8, targetReps: null, completed: true,
    duration: null, distance: null, distanceUnit: 'km', rounds: null, recovery: null, rest: null, targetRpe: null, rpe: null, comment: null, options: null, fields: null,
  });
  assert.deepEqual(ops.getTemplate(db, 't1').exercises, [{
    exerciseId: 'e1', name: 'Bench Press', mode: 'reps', exerciseNote: null, superset: null,
    sets: [{ type: 'normal', weight: 80, unit: 'kg', reps: 8, duration: null, distance: null, distanceUnit: 'km', rounds: null, recovery: null, rest: null, targetRpe: null, options: null }],
  }]);
});

test('delete and reorder keep positions contiguous', () => {
  const { db, ids } = setup();
  const w = ops.getWorkout(db, ops.startWorkout(db, { fromWorkoutId: ids[0] }));
  const bench = w.exercises[0];
  const [s0, s1, s2, s3] = bench.sets.map((s) => s.id);
  ops.deleteSet(db, s1);
  ops.moveSet(db, s3, 0);
  const added = ops.addSet(db, bench.id);
  assert.deepEqual(ops.getWorkout(db, w.id).exercises[0].sets.map((s) => s.id), [s3, s0, s2, added]);
  assert.deepEqual(positions(db, 'workout_set', 'workout_exercise_id', bench.id), [0, 1, 2, 3]);
  assert.throws(() => ops.moveSet(db, s0, 4), /Invalid position/);

  ops.moveExercise(db, w.exercises[2].id, 0);
  ops.removeExercise(db, w.exercises[0].id);
  assert.deepEqual(ops.getWorkout(db, w.id).exercises.map((e) => e.name), ['Cable Fly', 'Overhead Press']);
  assert.deepEqual(positions(db, 'workout_exercise', 'workout_id', w.id), [0, 1]);
  assert.throws(() => ops.deleteSet(db, 'missing'), /Not found/);
});

test('a deleted set restores with its id, values and position', () => {
  const { db, ids } = setup();
  const w = ops.getWorkout(db, ops.startWorkout(db, { fromWorkoutId: ids[0] }));
  const bench = w.exercises[0];
  const [s0, s1, s2] = bench.sets.map((s) => s.id);
  ops.correctSet(db, s1, { weight: 97.5, reps: 4, type: 'drop', rpe: 9, comment: 'grind', completed: true });
  const before = ops.getWorkout(db, w.id).exercises[0].sets;
  const deleted = ops.deleteSet(db, s1);
  assert.deepEqual(ops.getWorkout(db, w.id).exercises[0].sets.map((s) => s.id), [s0, s2, ...before.slice(3).map((s) => s.id)]);
  ops.restoreSet(db, JSON.parse(JSON.stringify(deleted)));
  assert.deepEqual(ops.getWorkout(db, w.id).exercises[0].sets, before);
  assert.deepEqual(positions(db, 'workout_set', 'workout_exercise_id', bench.id), before.map((_, i) => i));

  const last = ops.deleteSet(db, before.at(-1)!.id);
  const first = ops.deleteSet(db, s0);
  ops.restoreSet(db, last);
  assert.equal(ops.getWorkout(db, w.id).exercises[0].sets.at(-1)!.id, before.at(-1)!.id);
  ops.restoreSet(db, first);
  assert.deepEqual(ops.getWorkout(db, w.id).exercises[0].sets, before);
  assert.throws(() => ops.restoreSet(db, first), /UNIQUE|PRIMARY/);
});

test('first run lasts until a finished workout, template, measurement or photo exists', () => {
  const db = openDb(':memory:');
  assert.equal(ops.firstRun(db), true);
  const w = ops.startWorkout(db);
  ops.addSet(db, ops.addExercise(db, w, ops.listExercises(db)[0].id));
  assert.equal(ops.firstRun(db), true);
  ops.finishWorkout(db, w);
  assert.equal(ops.firstRun(db), false);
});

test('the backup reminder is due 30 days after the first workout, export or dismissal, never with a backup folder', () => {
  const db = openDb(':memory:');
  const at = (days: number) => new Date(Date.now() + days * 86400000);
  assert.equal(ops.backupDue(db, at(90)), false);
  const w = ops.startWorkout(db);
  ops.addSet(db, ops.addExercise(db, w, ops.listExercises(db)[0].id));
  ops.finishWorkout(db, w);
  assert.equal(ops.backupDue(db, at(29)), false);
  assert.equal(ops.backupDue(db, at(30)), true);
  ops.setSetting(db, 'exportedAt', at(20).toISOString());
  assert.equal(ops.backupDue(db, at(30)), false);
  assert.equal(ops.backupDue(db, at(50)), true);
  ops.setSetting(db, 'backupDismissedAt', at(50).toISOString());
  assert.equal(ops.backupDue(db, at(79)), false);
  assert.equal(ops.backupDue(db, at(80)), true);
  ops.setSetting(db, 'backupDismissedAt', 'garbage');
  assert.equal(ops.backupDue(db, at(50)), true);
  ops.setSetting(db, 'backupDismissedAt', at(90).toISOString());
  assert.equal(ops.backupDue(db, at(80)), true);
  ops.setSetting(db, 'backupFolder', 'content://folder');
  assert.equal(ops.backupDue(db, at(80)), false);
  ops.setSetting(db, 'backupFolder', '');
  assert.equal(ops.backupDue(db, at(80)), true);
});

test('a new set copies the previous set, then the last earlier working set, then zero', () => {
  const { db, ids, id } = setup();
  const w = ops.startWorkout(db);
  const bench = ops.addExercise(db, w, id('Bench Press'));
  const first = ops.addSet(db, bench);
  assert.deepEqual([ops.getWorkout(db, w).exercises[0].sets[0].type, ops.getWorkout(db, w).exercises[0].sets[0].weight], ['normal', 82.5]);
  ops.correctSet(db, first, { weight: 90, reps: 5, type: 'drop', targetRpe: 8, rpe: 9, rest: 150, comment: 'paused', fields: 'rpe,comment', completed: true });
  ops.addSet(db, bench, { reps: 4 });
  const run = ops.addExercise(db, w, id('Run'));
  ops.addSet(db, run);
  const sets = ops.getWorkout(db, w).exercises.map((e) => e.sets.at(-1));
  const { type, weight, reps, targetRpe, rpe, rest, comment, fields, completed } = sets[0]!;
  assert.deepEqual({ type, weight, reps, targetRpe, rpe, rest, comment, fields, completed }, { type: 'normal', weight: 90, reps: 4, targetRpe: 8, rpe: 9, rest: 150, comment: 'paused', fields: 'rpe,comment', completed: false });
  assert.deepEqual([sets[1]?.distance, sets[1]?.duration], [null, null]);
  assert.throws(() => ops.correctSet(db, first, { fields: 'rpe,weight' }), /Fields must be/);

  ops.finishWorkout(db, w);
  const oldFly = ops.addExercise(db, ids[0], id('Bench Press'));
  ops.addSet(db, oldFly);
  assert.deepEqual(ops.getWorkout(db, ids[0]).exercises.at(-1)?.sets.map((s) => [s.weight, s.reps]), [[0, 0]]);
});

test('only one workout is unfinished at a time', () => {
  const { db, ids } = setup();
  const w = ops.startWorkout(db);
  assert.throws(() => ops.startWorkout(db, { fromWorkoutId: ids[0] }), /unfinished/);
  ops.finishWorkout(db, w);
  assert.throws(() => ops.startWorkout(db, { fromWorkoutId: ids[0], templateId: 'x' }), /not both/);
});

test('starting from an earlier workout copies plan and visibility only', () => {
  const { db, ids } = setup();
  const before = ops.getWorkout(db, ids[3]);
  const [bench, press, fly] = before.exercises;
  ops.linkSuperset(db, press.id, fly.id);
  ops.correctSet(db, bench.sets[1].id, { targetRpe: 8, rpe: 9, rest: 200, comment: 'grind', options: true });
  ops.correctSet(db, bench.sets[0].id, { fields: 'rest' });

  const copy = ops.getWorkout(db, ops.startWorkout(db, { fromWorkoutId: before.id }));
  assert.equal(copy.name, 'Push A');
  assert.equal(copy.finishedAt, null);
  const set = copy.exercises[0].sets[1];
  assert.deepEqual([set.targetRpe, set.rest, set.options, set.rpe, set.comment, set.completed], [8, 200, true, null, null, false]);
  assert.equal(copy.exercises[0].sets[0].fields, 'rest');
  assert.ok(copy.exercises[1].superset && copy.exercises[1].superset === copy.exercises[2].superset);
  assert.notEqual(copy.exercises[1].superset, ops.getWorkout(db, before.id).exercises[1].superset);
  ops.correctSet(db, set.id, { weight: 1 });
  assert.equal(ops.getWorkout(db, before.id).exercises[0].sets[1].weight, 82.5);
});

test('supersets link, merge and unlink within one workout', () => {
  const { db, ids } = setup();
  const [a, b, c] = ops.getWorkout(db, ids[0]).exercises.map((e) => e.id);
  const groups = () => ops.getWorkout(db, ids[0]).exercises.map((e) => e.superset);
  ops.linkSuperset(db, a, b);
  ops.linkSuperset(db, c, a);
  assert.equal(new Set(groups()).size, 1);
  const [x, y] = ops.getWorkout(db, ids[1]).exercises.map((e) => e.id);
  const [p, q] = ops.getWorkout(db, ids[2]).exercises.map((e) => e.id);
  ops.linkSuperset(db, x, y);
  ops.unlinkSuperset(db, x);
  ops.linkSuperset(db, p, q);
  assert.deepEqual(ops.getWorkout(db, ids[1]).exercises.map((e) => e.superset), [null, null]);
  ops.unlinkSuperset(db, b);
  ops.removeExercise(db, c);
  assert.deepEqual(groups(), [null, null]);
  assert.throws(() => ops.linkSuperset(db, a, ops.getWorkout(db, ids[1]).exercises[0].id), /one workout/);
});

test('moving an exercise keeps superset members together', () => {
  const { db, ids } = setup();
  const w = ops.startWorkout(db, { fromWorkoutId: ids[0] });
  const [bench, press, fly] = ops.getWorkout(db, w).exercises.map((e) => e.id);
  const order = () => ops.getWorkout(db, w).exercises.map((e) => e.name);
  ops.linkSuperset(db, bench, fly);
  ops.moveExerciseBlock(db, press, -1);
  assert.deepEqual(order(), ['Overhead Press', 'Bench Press', 'Cable Fly']);
  ops.moveExerciseBlock(db, fly, 1);
  assert.deepEqual(order(), ['Overhead Press', 'Bench Press', 'Cable Fly']);
  ops.moveExerciseBlock(db, fly, -1);
  assert.deepEqual(order(), ['Bench Press', 'Cable Fly', 'Overhead Press']);
  assert.deepEqual(positions(db, 'workout_exercise', 'workout_id', w), [0, 1, 2]);
  assert.deepEqual(ops.listTemplates(db).map((t) => [t.name, t.count]), [['Legs', 2], ['Pull B', 2], ['Push A', 3]]);
  assert.deepEqual(ops.listExercises(db).find((e) => e.name === 'Run')?.mode, 'distance');
});

test('discard deletes only an unfinished workout', () => {
  const { db, ids } = setup();
  const w = ops.startWorkout(db, { fromWorkoutId: ids[0] });
  assert.deepEqual(ops.unfinishedWorkouts(db).map((x) => x.id), [w]);
  ops.discardWorkout(db, w);
  assert.deepEqual(ops.unfinishedWorkouts(db), []);
  assert.equal(db.all('SELECT COUNT(*) AS n FROM workout_set s LEFT JOIN workout_exercise we ON we.id = s.workout_exercise_id WHERE we.id IS NULL')[0].n, 0);
  assert.throws(() => ops.discardWorkout(db, ids[0]), /unfinished/);
});

test('editing a default mapping affects later workouts only', () => {
  const { db, ids, id } = setup();
  ops.setDefaultMapping(db, id('Cable Fly'), [{ muscle: 'chest', role: 'primary' }, { muscle: 'shoulders', role: 'secondary' }]);
  assert.deepEqual(ops.getWorkout(db, ids[0]).exercises[2].mapping, [{ muscle: 'chest', role: 'primary' }]);
  const next = ops.getWorkout(db, ops.startWorkout(db, { fromWorkoutId: ids[0] }));
  assert.deepEqual(next.exercises[2].mapping, [{ muscle: 'chest', role: 'primary' }, { muscle: 'shoulders', role: 'secondary' }]);
});

test('invalid logging input is rejected', () => {
  const { db, ids } = setup();
  const set = ops.getWorkout(db, ids[0]).exercises[0].sets[0].id;
  assert.throws(() => ops.correctSet(db, set, { rpe: 11 }), /RPE/);
  assert.throws(() => ops.correctSet(db, set, { duration: -1 }), /non-negative/);
  assert.throws(() => ops.correctSet(db, set, { rounds: 1.5 }), /non-negative/);
  assert.throws(() => ops.correctSet(db, set, { rest: 1.5 }), /non-negative/);
  assert.throws(() => ops.createExercise(db, 'Swim', [], { rest: -1 }), /whole seconds/);
  assert.throws(() => ops.createExercise(db, 'Swim', [], { mode: 'laps' as never }), /Mode/);
  assert.throws(() => ops.createExercise(db, '  ', []), /name/);
  assert.throws(() => ops.createExercise(db, 'Plank', []), /UNIQUE/);
});

test('history filters by exercise and limit; recent keeps the latest of each name', () => {
  const { db } = setup();
  const all = ops.history(db);
  assert.deepEqual(ops.history(db, undefined, 2), all.slice(0, 2));
  const bench = ops.history(db, 'Bench Press', 1);
  assert.equal(bench.length, 1);
  assert.equal(bench[0].id, all.find((w) => w.exercises.some((e) => e.name === 'Bench Press'))!.id);
  assert.deepEqual(bench[0].exercises.map((e) => e.name), ['Bench Press']);
  const recent = ops.recentWorkouts(db, 10);
  assert.deepEqual(recent.map((w) => w.id), all.filter((w, i) => all.findIndex((x) => x.name === w.name) === i).map((w) => w.id));
  assert.equal(ops.recentWorkouts(db, 1).length, 1);
});

test('a weighted hold keeps its weight through history and records', () => {
  const { db, id } = setup();
  const day = (at: string, sets: Parameters<typeof ops.addSet>[2][]) => {
    const w = ops.startWorkout(db, { now: new Date(at), timeZone: 'UTC' });
    const plank = ops.addExercise(db, w, id('Plank'));
    const ids = sets.map((s) => ops.addSet(db, plank, { completed: true, ...s }));
    ops.finishWorkout(db, w);
    return ids;
  };
  const [first, , bare] = day('2026-10-01T07:00:00Z', [{ weight: 10, duration: 60 }, { weight: 20, duration: 120, type: 'warm-up' }, { weight: 0, duration: 90 }]);
  day('2026-10-02T07:00:00Z', [{ weight: 10, duration: 60 }, { weight: 10, duration: 45, completed: false }]);

  assert.deepEqual(ops.history(db, 'Plank').map((w) => w.exercises[0].sets.map((s) => [s.weight, s.duration])), [[[10, 60], [10, 45]], [[10, 60], [20, 120], [0, 90]]]);
  const p = ops.progress(db, 'Plank');
  assert.equal(p.longest?.set.id, bare);
  assert.deepEqual(p.holds.map((h) => [h.set.id, h.set.weight, h.set.duration]), [[first, 10, 60], [bare, 0, 90]]);
  assert.equal(p.weight, null);

  const [lb] = day('2026-10-03T07:00:00Z', [{ weight: 22, unit: 'lb', duration: 50 }, { weight: 0, unit: 'lb', duration: 30 }]);
  assert.deepEqual(ops.progress(db, 'Plank').holds.map((h) => h.set.id), [first, lb, bare]);
  assert.deepEqual(ops.progress(db, 'Bench Press').holds, []);
});

test('closing an empty finished workout deletes it', () => {
  const { db, id } = setup();
  const empty = ops.logWorkout(db, '2026-10-01');
  assert.equal(ops.logWorkout(db, '2026-10-01'), empty);
  ops.addExercise(db, empty, id('Plank'));
  ops.closeWorkout(db, empty);
  assert.throws(() => ops.getWorkout(db, empty), /Not found/);

  const kept = ops.logWorkout(db, '2026-10-01');
  ops.addSet(db, ops.addExercise(db, kept, id('Plank')), { duration: 30 });
  ops.closeWorkout(db, kept);
  const active = ops.startWorkout(db, {});
  ops.closeWorkout(db, active);
  assert.deepEqual([ops.getWorkout(db, kept).id, ops.getWorkout(db, active).id], [kept, active]);
});

test('a workout summary counts its own volume, muscles, records and trends', () => {
  const { db, ids: [pushA, , , pushA2], id } = setup();
  const first = ops.workoutSummary(db, pushA);
  assert.deepEqual([first.minutes, first.sets, first.volume, first.records], [60, 7, 2860, 4]);
  assert.deepEqual(
    first.muscles.map((m) => [m.muscle, m.sets, m.exercises.map((e) => `${e.exercise} ${e.sets}`)]),
    [
      ['chest', 5, ['Bench Press 3', 'Cable Fly 2']],
      ['shoulders', 3.5, ['Overhead Press 2', 'Bench Press 1.5']],
      ['triceps', 2.5, ['Bench Press 1.5', 'Overhead Press 1']],
    ],
  );
  assert.deepEqual(first.exercises.map((e) => [e.top?.weight, e.top?.reps, e.records.length, e.trend.length]), [[82.5, 8, 1, 1], [50, 6, 1, 1], [15, 12, 2, 1]]);
  const later = ops.workoutSummary(db, pushA2);
  assert.equal(later.records, 0);
  assert.deepEqual(later.exercises[0].trend, [{ date: '2026-09-29', value: 82.5 * (1 + 8 / 30) }, { date: '2026-10-06', value: 82.5 * (1 + 8 / 30) }]);

  const day = (at: string, plank: number, run = false) => {
    const w = ops.startWorkout(db, { now: new Date(at), timeZone: 'UTC' });
    ops.addSet(db, ops.addExercise(db, w, id('Plank')), { completed: true, weight: 20, duration: plank });
    if (run) ops.addSet(db, ops.addExercise(db, w, id('Run')), { completed: true, distance: 5, duration: 1500 });
    ops.finishWorkout(db, w, new Date(Date.parse(at) + 600000));
    return w;
  };
  const days = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(10 + i).padStart(2, '0')}T07:00:00Z`, 30 + i, i === 8));
  const ninth = ops.workoutSummary(db, days[8]);
  assert.deepEqual([ninth.minutes, ninth.sets, ninth.volume, ninth.records], [10, 2, 0, 0]);
  assert.deepEqual(ninth.exercises[0].trend.map((t) => t.value), [31, 32, 33, 34, 35, 36, 37, 38]);
  assert.equal(ninth.exercises[0].top?.duration, 38);
  assert.deepEqual([ninth.exercises[1].trend, ninth.exercises[1].top], [[], null]);
  assert.equal(ops.workoutSummary(db, days[9]).exercises[0].records.length, 1);
});

test('a custom exercise copies an existing one, equipment, bar and note included', () => {
  const { db, id } = setup();
  const bench = id('Barbell Bench Press - Medium Grip');
  ops.setBar(db, bench, 15, 'kg');
  ops.setExerciseNote(db, bench, 'seat 4');
  const draft = ops.exerciseDraft(db, bench);
  assert.equal(draft.equipment, 'barbell');
  assert.deepEqual(draft.mapping.map((m) => m.role).sort(), ['primary', 'secondary', 'secondary']);
  const copy = ops.createExercise(db, 'Close Bench', draft.mapping, draft);
  assert.deepEqual({ ...ops.exerciseDraft(db, copy), name: draft.name }, draft);
  assert.equal(ops.exerciseKit(db, 'kg', ops.listExercises(db, 'Close Bench')[0])?.bar, 15);

  const trap = ops.exerciseDraft(db, id('Trap Bar Deadlift'));
  const trapCopy = ops.createExercise(db, 'Trap Pull', trap.mapping, trap);
  assert.equal(ops.exerciseKit(db, 'kg', ops.listExercises(db, 'Trap Pull')[0])?.bar, 20, 'a copied bar exercise uses the Settings bar');
  assert.equal(ops.exerciseDraft(db, trapCopy).equipment, 'trap bar');
  ops.createExercise(db, 'Close Grip', trap.mapping, { equipment: 'Barbell, close grip' });
  assert.equal(ops.exerciseKit(db, 'kg', ops.listExercises(db, 'Close Grip')[0])?.bar, 20, 'edited bar equipment keeps the bar');

  const hold = ops.createExercise(db, 'Bench Hold', [], { ...draft, mode: 'duration', equipment: '  ' });
  assert.deepEqual([ops.exerciseDraft(db, hold).bar, ops.exerciseDraft(db, hold).equipment], [null, null], 'only weight × reps keeps a bar');
  assert.throws(() => ops.createExercise(db, 'Bad Bar', [], { bar: 0, barUnit: 'kg' }), /Bar weight/);
});

test('an exercise added after another lands after its superset block, in the order shown', () => {
  const { db, id } = setup();
  const w = ops.startWorkout(db, {});
  const [a, b, c] = ['Bench Press', 'Plank', 'Run'].map((name) => ops.addExercise(db, w, id(name)));
  ops.linkSuperset(db, a, b);
  ops.linkSuperset(db, b, c);
  ops.unlinkSuperset(db, b);
  const names = () => ops.getWorkout(db, w).exercises.map((e) => e.name);
  const shown = () => supersetBlocks(ops.getWorkout(db, w).exercises).flat().map((e) => e.name);
  assert.deepEqual(shown(), ['Bench Press', 'Run', 'Plank']);
  ops.addExercise(db, w, id('Bike Sprints'), a);
  assert.deepEqual(names(), ['Bench Press', 'Run', 'Bike Sprints', 'Plank']);
  ops.addExercise(db, w, id('Mobility Flow'), b);
  assert.deepEqual(names(), ['Bench Press', 'Run', 'Bike Sprints', 'Plank', 'Mobility Flow']);
  assert.throws(() => ops.addExercise(db, w, id('Bench Press'), 'missing'), /Not found/);
});
