import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { bodyweight } from '../assets/catalog/bodyweight.ts';
import { catalog } from '../assets/catalog/exercises.ts';
import { addMeasurement, bodyWeight, logBodyWeight } from '../src/domain/measurements.ts';
import { advance, e1rm, localDate, repMaxes, shownFields, unusual, wholeIn } from '../src/domain/rules.ts';
import {
  addExercise,
  addSet,
  correctSet,
  deleteWorkout,
  getWorkout,
  history,
  homeLayout,
  logWorkout,
  moveWorkout,
  muscleTotals,
  progress,
  remapExercise,
  renameWorkout,
  setSetting,
  startWorkout,
  workoutsOn,
  lifts,
  totalVolume,
  weeklyVolume,
  workoutSummary,
  suggest,
  personalRecords,
  starRecord,
} from '../src/domain/workouts.ts';

const setup = () => {
  const db = openDb(':memory:');
  const [pushA, pullB, legs, pushA2] = seed(db);
  return { db, pushA: getWorkout(db, pushA), pullB, legs, pushA2: getWorkout(db, pushA2) };
};

const totals = (db: ReturnType<typeof openDb>, date = '2026-10-04') => Object.fromEntries(muscleTotals(db, date).totals.map((t) => [t.muscle, t.sets]));

const fixtureWeek = { back: 7.5, chest: 5, shoulders: 3.5, biceps: 3, glutes: 3, hamstrings: 3, quads: 3, triceps: 2.5 };

test('muscle sets over the last 7 days count completed normal and drop sets only', () => {
  const { db } = setup();
  const week = muscleTotals(db, '2026-10-04');
  assert.deepEqual([week.from, week.to], ['2026-09-28', '2026-10-04']);
  assert.deepEqual(totals(db), fixtureWeek);
});

test('each muscle breaks down into the exercises that make up its sets', () => {
  const { db } = setup();
  for (const m of muscleTotals(db, '2026-10-04').totals)
    assert.equal(m.exercises.reduce((sum, e) => sum + e.sets, 0), m.sets, m.muscle);
  const by = (muscle: string) => muscleTotals(db, '2026-10-04').totals.find((m) => m.muscle === muscle)?.exercises.map((e) => `${e.exercise} ${e.sets}`);
  assert.deepEqual(by('back'), ['Barbell Row 3', 'Pull-up 3', 'Romanian Deadlift 1.5']);
  assert.deepEqual(by('triceps'), ['Bench Press 1.5', 'Overhead Press 1']);
});

test('muscle sets cover the 7 days ending on the given date', () => {
  const { db } = setup();
  assert.equal(totals(db, '2026-10-03').quads, undefined);
  assert.equal(totals(db, '2026-10-10').quads, 3);
  assert.equal(totals(db, '2026-10-11').quads, undefined);
  assert.equal(totals(db, '2026-10-05').chest, 5);
  assert.throws(() => setSetting(db, 'weightUnit', 'stone'));
});

test('workout date is the local date of its time zone', () => {
  const { pushA } = setup();
  assert.equal(pushA.date, '2026-09-29');
  assert.equal(pushA.startedAt, '2026-09-28T20:30:00.000Z');
  assert.equal(localDate(new Date('2026-09-28T20:30:00Z'), 'UTC'), '2026-09-28');
});

test('corrections update totals', () => {
  const { db, pushA, legs } = setup();
  const [bench, press] = pushA.exercises;
  correctSet(db, bench.sets[0].id, { type: 'normal' });
  correctSet(db, press.sets[2].id, { completed: true });
  moveWorkout(db, legs, '2026-10-06');
  assert.deepEqual(totals(db), { back: 6, chest: 6, shoulders: 5, biceps: 3, triceps: 3.5 });
});

test('a workout can be renamed but not blanked', () => {
  const { db, pushA } = setup();
  renameWorkout(db, pushA.id, '  Push heavy ');
  assert.equal(getWorkout(db, pushA.id).name, 'Push heavy');
  assert.throws(() => renameWorkout(db, pushA.id, ' '), /name is required/);
});

test('a mapping correction changes only that workout', () => {
  const { db, pushA, pushA2 } = setup();
  remapExercise(db, pushA.exercises[2].id, [{ muscle: 'shoulders', role: 'primary' }]);
  assert.deepEqual(totals(db), { ...fixtureWeek, chest: 3, shoulders: 5.5 });
  assert.deepEqual(getWorkout(db, pushA2.id).exercises[2].mapping, [{ muscle: 'chest', role: 'primary' }]);
});

test('workouts are independent of their template', () => {
  const { db, pushA } = setup();
  correctSet(db, pushA.exercises[0].sets[1].id, { weight: 200 });
  const next = getWorkout(db, startWorkout(db, { templateId: db.all("SELECT id FROM template WHERE name = 'Push A'")[0].id as string }));
  assert.equal(next.exercises[0].sets[1].weight, 82.5);
  assert.ok(next.exercises.every((e) => e.sets.every((s) => !s.completed)));
  assert.equal(history(db).length, 4);
});

test('invalid input is rejected without writes', () => {
  const { db, pushA } = setup();
  const exercise = pushA.exercises[0];
  assert.throws(() => addSet(db, exercise.id, { type: 'cluster' as never, weight: 1, reps: 1 }), /set type/);
  assert.throws(() => addSet(db, exercise.id, { type: 'normal', weight: -1, reps: 1 }));
  assert.throws(() => correctSet(db, exercise.sets[0].id, { reps: 1.5 }));
  assert.throws(() => moveWorkout(db, pushA.id, '2026-02-30'), /Invalid date/);
  assert.throws(() => moveWorkout(db, pushA.id, '2999-01-01'), /Cannot move a workout to a future date/);
  assert.throws(() => remapExercise(db, exercise.id, [{ muscle: ' ', role: 'primary' }]));
  assert.deepEqual(getWorkout(db, pushA.id), pushA);
});

test('mapping muscles are trimmed and impossible dates rejected', () => {
  const { db, pushA } = setup();
  remapExercise(db, pushA.exercises[0].id, [{ muscle: ' chest ', role: 'primary' }]);
  assert.deepEqual(getWorkout(db, pushA.id).exercises[0].mapping, [{ muscle: 'chest', role: 'primary' }]);
  assert.throws(() => moveWorkout(db, pushA.id, '2026-13-01'), /Invalid date/);
  assert.throws(() => muscleTotals(db, '2026-13-01'), /Invalid date/);
});

test('records use working sets, keep the earliest tie and name their source set', () => {
  const { db, pushA } = setup();
  const bench = pushA.exercises[0];
  const p = progress(db, 'Bench Press');
  assert.equal(p.sessions.length, 2);
  assert.equal(p.weight?.set.id, bench.sets[1].id);
  assert.equal(p.weight?.workoutId, pushA.id);
  assert.equal(p.estimate?.value, e1rm(82.5, 8));
  assert.deepEqual(
    p.reps.map((r) => [r.set.weight, r.set.reps, r.date]),
    [[82.5, 8, '2026-09-29']],
  );
  assert.equal(e1rm(100, 30), 200);
});

test('editing an old workout updates its totals and records', () => {
  const { db, pushA } = setup();
  const bench = pushA.exercises[0];
  correctSet(db, bench.sets[2].id, { weight: 90, reps: 5 });
  correctSet(db, bench.sets[0].id, { weight: 120 });
  const p = progress(db, 'Bench Press');
  assert.equal(p.weight?.set.id, bench.sets[2].id);
  assert.deepEqual([p.estimate?.value, p.estimate?.set.id], [105, bench.sets[2].id]);
  assert.deepEqual(
    p.reps.map((r) => [r.set.weight, r.set.reps]),
    [
      [90, 5],
      [82.5, 8],
    ],
  );
  correctSet(db, bench.sets[2].id, { completed: false });
  correctSet(db, bench.sets[1].id, { type: 'warm-up' });
  assert.deepEqual(totals(db), { ...fixtureWeek, chest: 3, shoulders: 2.5, triceps: 1.5 });
  moveWorkout(db, pushA.id, '2026-10-05');
  assert.equal(progress(db, 'Bench Press').weight?.date, '2026-10-05');
  assert.equal(totals(db).chest, undefined);
  assert.equal(totals(db, '2026-10-06').chest, 7);
});

test('a workout logged on a past date is finished, editable and deletable', () => {
  const { db } = setup();
  assert.throws(() => logWorkout(db, '2026-02-30'));
  assert.throws(() => logWorkout(db, '2999-01-01'));
  const id = logWorkout(db, '2026-09-30', 'Australia/Brisbane');
  const logged = getWorkout(db, id);
  assert.equal(logged.date, '2026-09-30');
  assert.ok(logged.finishedAt);
  assert.deepEqual(workoutsOn(db, '2026-09-30').map((w) => w.id), [id]);
  const squat = addExercise(db, id, db.all("SELECT id FROM exercise WHERE name = 'Back Squat'")[0].id as string);
  addSet(db, squat, { weight: 100, reps: 5, completed: true });
  assert.equal(totals(db).quads, 4);
  assert.equal(progress(db, 'Back Squat').weight?.set.weight, 102.5);
  startWorkout(db);
  deleteWorkout(db, id);
  assert.equal(totals(db).quads, 3);
  assert.throws(() => deleteWorkout(db, id));
});

test('history loads every workout\'s exercises, mappings and sets as each workout alone does', () => {
  const { db } = setup();
  logWorkout(db, '2026-09-30', 'Australia/Brisbane');
  const all = history(db);
  assert.equal(all.length, 5);
  assert.deepEqual(all, all.map((w) => getWorkout(db, w.id)));
  assert.deepEqual(all.find((w) => w.date === '2026-09-30')?.exercises, []);
  const bench = history(db, 'Bench Press');
  assert.deepEqual(bench.map((w) => w.exercises.map((e) => e.name)), [['Bench Press'], ['Bench Press']]);
  assert.deepEqual(bench.map((w) => w.exercises[0]), bench.map((w) => getWorkout(db, w.id).exercises.find((e) => e.name === 'Bench Press')));
});

test('equal records across sessions keep the earliest, including equal e1RM', () => {
  const { db, pushA, pushA2 } = setup();
  correctSet(db, pushA.exercises[0].sets[1].id, { weight: 35, reps: 10 });
  correctSet(db, pushA2.exercises[0].sets[1].id, { weight: 40, reps: 5 });
  for (const w of [pushA, pushA2]) for (const s of w.exercises[0].sets.slice(2)) correctSet(db, s.id, { completed: false });
  const p = progress(db, 'Bench Press');
  assert.equal(p.estimate?.set.id, pushA.exercises[0].sets[1].id);
  correctSet(db, pushA2.exercises[0].sets[1].id, { weight: 35, reps: 10 });
  assert.equal(progress(db, 'Bench Press').weight?.workoutId, pushA.id);
});

test('earlier sessions follow a corrected date', () => {
  const { db, pushA, pushA2 } = setup();
  assert.equal(history(db, 'Bench Press', 1, pushA2)[0].id, pushA.id);
  moveWorkout(db, pushA2.id, '2026-09-20');
  assert.equal(history(db, 'Bench Press', 1, { ...pushA2, date: '2026-09-20' }).length, 0);
  assert.equal(history(db, 'Bench Press', 1, pushA)[0].id, pushA2.id);
  correctSet(db, pushA2.exercises[0].sets[1].id, { weight: 70 });
  const fresh = addExercise(db, logWorkout(db, '2026-09-25', 'Australia/Brisbane'), pushA.exercises[0].exerciseId);
  addSet(db, fresh);
  assert.equal(getWorkout(db, db.all('SELECT workout_id FROM workout_exercise WHERE id = ?', [fresh])[0].workout_id as string).exercises[0].sets[0].weight, 70);
});

test('volume adds the body weight logged on or before the workout date, else the first, to bodyweight lifts', () => {
  const { db } = setup();
  assert.ok([...bodyweight].every((source) => catalog[source]?.mode === 'reps'));
  const week = totalVolume(db, '2026-10-09', 'week');
  const pullups = db.all("SELECT id FROM exercise WHERE source = 'Pullups'")[0].id as string;
  const workout = logWorkout(db, '2026-10-08', 'Australia/Brisbane');
  const exercise = addExercise(db, workout, pullups);
  addSet(db, exercise);
  addSet(db, exercise);
  const [plain, weighted] = getWorkout(db, workout).exercises[0].sets;
  correctSet(db, plain.id, { weight: 0, reps: 10, completed: true });
  correctSet(db, weighted.id, { weight: 20, unit: 'kg', reps: 5, completed: true });
  assert.equal(bodyWeight(db, '2026-10-08'), null);
  assert.equal(totalVolume(db, '2026-10-09', 'week'), week + 100);
  addMeasurement(db, { preset: 'body-weight' }, 80, '2026-10-09');
  assert.equal(totalVolume(db, '2026-10-09', 'week'), week + 100 + 80 * 15);
  logBodyWeight(db, 70, '2026-10-01');
  logBodyWeight(db, 75, '2026-10-01');
  assert.equal(db.all('SELECT * FROM measurement').length, 2);
  assert.equal(totalVolume(db, '2026-10-09', 'week'), week + 100 + 75 * 15);
  assert.equal(bodyWeight(db, '2026-10-09'), 80);
});

test('volume sums weight × reps of completed working sets in kg over the chosen range', () => {
  const { db, pushA2 } = setup();
  assert.equal(totalVolume(db, '2026-10-09', 'week'), 3060 + 3697.5);
  assert.equal(totalVolume(db, '2026-10-09', 'month'), 3060 + 3697.5 + 2860 + 1740);
  assert.equal(totalVolume(db, '2026-10-09', 'all'), totalVolume(db, '2026-10-09', 'month'));
  assert.equal(totalVolume(db, '2026-10-05', 'week'), 3697.5 + 1740 + 2860);
  correctSet(db, pushA2.exercises[0].sets[1].id, { weight: 100, unit: 'lb' });
  assert.equal(totalVolume(db, '2026-10-09', 'week'), 3060 + 3697.5 - 660 + 100 * 0.45359237 * 8);
  assert.throws(() => totalVolume(db, '2026-10-09', 'year' as 'all'), /Range must be/);
  assert.throws(() => totalVolume(db, '2026-10-09', 'toString' as 'all'), /Range must be/);
  assert.equal(wholeIn(1234.46 * 0.45359237, 'lb'), 1234);
  db.run("UPDATE exercise SET mode = 'duration'");
  assert.equal(totalVolume(db, '2026-10-09', 'all'), 0);
});

test('lifts list reps and duration exercises with working sets, most recent first, with an e1RM per session', () => {
  const { db, pushA, pushA2 } = setup();
  assert.deepEqual(lifts(db).map((l) => l.name), ['Bench Press', 'Cable Fly', 'Overhead Press', 'Back Squat', 'Romanian Deadlift', 'Barbell Row', 'Pull-up']);
  correctSet(db, pushA.exercises[0].sets[1].id, { weight: 90, reps: 3 });
  correctSet(db, pushA2.exercises[0].sets[2].id, { weight: 200, unit: 'lb', reps: 5 });
  assert.deepEqual(progress(db, 'Bench Press').trend, [
    { date: '2026-09-29', value: e1rm(82.5, 8) },
    { date: '2026-10-06', value: e1rm(200 * 0.45359237, 5) },
  ]);
  assert.deepEqual(progress(db, 'Pull-up').trend, []);
});

test('weekly volume buckets the 7-day windows ending today back to the first workout, the last matching Past week', () => {
  const { db } = setup();
  assert.deepEqual(weeklyVolume(db, '2026-10-09'), [
    { date: '2026-10-02', value: 2860 + 1740 },
    { date: '2026-10-09', value: 3060 + 3697.5 },
  ]);
  assert.equal(weeklyVolume(db, '2026-10-23').at(-1)?.value, totalVolume(db, '2026-10-23', 'week'));
  assert.deepEqual(weeklyVolume(db, '2026-10-23').map((w) => w.value), [2860 + 1740, 3060 + 3697.5, 0, 0]);
  assert.deepEqual(weeklyVolume(db, '2026-09-01'), []);
  assert.throws(() => weeklyVolume(db, '2026-13-01'), /Invalid date/);
});

test('record trends hold each workout\'s heaviest weight, best e1RM and longest hold, oldest first', () => {
  const { db, pushA, pushA2 } = setup();
  correctSet(db, pushA2.exercises[0].sets[2].id, { weight: 200, unit: 'lb', reps: 5 });
  const p = progress(db, 'Bench Press');
  assert.deepEqual(p.trends.e1rm, p.trend);
  assert.deepEqual(p.trends.weight.map((t) => t.date), p.trend.map((t) => t.date));
  assert.equal(p.trends.weight.at(-1)?.value, 200 * 0.45359237);
  assert.deepEqual(p.trends.hold, []);
  correctSet(db, pushA.exercises[0].sets[0].id, { type: 'warm-up', weight: 500 });
  assert.ok(progress(db, 'Bench Press').trends.weight[0].value < 500);
  db.run("UPDATE exercise SET mode = 'duration' WHERE name = 'Cable Fly'");
  correctSet(db, getWorkout(db, pushA2.id).exercises.find((e) => e.name === 'Cable Fly')!.sets[0].id, { duration: 45 });
  assert.deepEqual(progress(db, 'Cable Fly').trends.hold, [{ date: pushA2.date, value: 45 }]);
});

test('PRs list each lift\'s current weight, e1RM and hold record, starred first, then most recent first', () => {
  const { db, pushA2 } = setup();
  const prs = () => personalRecords(db).map((r) => `${r.starred ? '*' : ''}${r.name} ${r.kind} ${r.date}`);
  assert.deepEqual(prs().slice(0, 3), ['Back Squat weight 2026-10-04', 'Back Squat e1rm 2026-10-04', 'Romanian Deadlift weight 2026-10-04']);
  const bench = personalRecords(db).find((r) => r.name === 'Bench Press' && r.kind === 'e1rm')!;
  assert.equal(bench.value, progress(db, 'Bench Press').estimate!.value);
  starRecord(db, bench.exerciseId, 'e1rm', true);
  starRecord(db, bench.exerciseId, 'e1rm', true);
  assert.equal(prs()[0], '*Bench Press e1rm 2026-09-29');
  assert.deepEqual(personalRecords(db, true).map((r) => `${r.name} ${r.kind}`), ['Bench Press e1rm']);
  correctSet(db, pushA2.exercises[0].sets[1].id, { weight: 100, reps: 5 });
  assert.deepEqual(prs().slice(0, 2), ['*Bench Press e1rm 2026-10-06', 'Bench Press weight 2026-10-06']);
  const change = (kind: string) => personalRecords(db).find((r) => r.name === 'Bench Press' && r.kind === kind)!.change;
  assert.deepEqual(change('weight'), { since: '2026-09-29', gain: 100 - 82.5 });
  assert.equal(change('e1rm')!.gain, personalRecords(db).find((r) => r.name === 'Bench Press' && r.kind === 'e1rm')!.trend.at(-1)!.value - progress(db, 'Bench Press').trend[0].value);
  assert.equal(personalRecords(db).find((r) => r.name === 'Back Squat')!.change, null);
  starRecord(db, bench.exerciseId, 'e1rm', false);
  assert.ok(!prs().some((r) => r.startsWith('*')));
  assert.throws(() => starRecord(db, bench.exerciseId, 'reps' as 'hold', true), /Record must be/);
  db.run("UPDATE exercise SET mode = 'duration' WHERE name = 'Cable Fly'");
  correctSet(db, getWorkout(db, pushA2.id).exercises.find((e) => e.name === 'Cable Fly')!.sets[0].id, { duration: 45 });
  assert.deepEqual(prs().filter((r) => r.startsWith('Cable Fly')), ['Cable Fly hold 2026-10-06']);
  assert.throws(() => starRecord(db, personalRecords(db).find((r) => r.name === 'Cable Fly')!.exerciseId, 'weight', true), /duration exercise has no weight record/);
});

const hints = (db: ReturnType<typeof openDb>, before?: { date: string; startedAt: string }) =>
  ['Bench Press', 'Overhead Press', 'Cable Fly'].map((name) => [name, suggest(db, name, before).map((s) => s?.weight ?? null)]);

test('a session where every working set met its target suggests the next weight up as a hint', () => {
  const { db, pushA2 } = setup();
  const raised = [['Bench Press', [null, 85, 85, 85]], ['Overhead Press', [52.5, 52.5, 52.5]], ['Cable Fly', [null, null]]];
  assert.deepEqual(hints(db), raised);
  const repeat = getWorkout(db, startWorkout(db, { fromWorkoutId: pushA2.id }));
  assert.deepEqual(repeat.exercises[0].sets.map((s) => s.weight), [40, 82.5, 82.5, 82.5]);
  assert.deepEqual(hints(db, repeat), raised);
  assert.deepEqual(suggest(db, 'Pull-up'), [null, null, null]);
});

test('a missed target, a blank target or an incomplete set suggests no increase; lb steps by 5', () => {
  const { db, pushA2 } = setup();
  const [bench, press, fly] = pushA2.exercises;
  correctSet(db, bench.sets[3].id, { reps: 7 });
  correctSet(db, press.sets[0].id, { targetReps: null });
  for (const s of fly.sets) correctSet(db, s.id, { unit: 'lb', completed: true });
  assert.deepEqual(hints(db), [['Bench Press', [null, null, null, null]], ['Overhead Press', [null, null, null]], ['Cable Fly', [20, 15]]]);
  correctSet(db, bench.sets[3].id, { reps: 8, completed: false });
  assert.deepEqual(hints(db)[0], ['Bench Press', [null, null, null, null]]);
});

test('a bodyweight lift adds the body weight on the workout date to its e1RM; weight records stay on the added weight', () => {
  const { db } = setup();
  const pullups = db.all("SELECT id FROM exercise WHERE source = 'Pullups'")[0].id as string;
  const name = db.all('SELECT name FROM exercise WHERE id = ?', [pullups])[0].name as string;
  const workout = logWorkout(db, '2026-10-08', 'Australia/Brisbane');
  const exercise = addExercise(db, workout, pullups);
  addSet(db, exercise);
  addSet(db, exercise);
  const [plain, weighted] = getWorkout(db, workout).exercises[0].sets;
  correctSet(db, plain.id, { weight: 0, reps: 12, completed: true });
  correctSet(db, weighted.id, { weight: 10, unit: 'kg', reps: 5, completed: true });
  assert.equal(progress(db, name).estimate?.value, e1rm(10, 5));
  addMeasurement(db, { preset: 'body-weight' }, 80, '2026-10-01');
  const p = progress(db, name);
  assert.deepEqual([p.weight?.set.id, p.estimate?.set.id, p.estimate?.value], [weighted.id, plain.id, e1rm(80, 12)]);
  assert.deepEqual(p.trend, [{ date: '2026-10-08', value: e1rm(80, 12) }]);
  const summary = workoutSummary(db, workout).exercises[0];
  assert.deepEqual([summary.top?.id, summary.estimate, summary.trend], [plain.id, e1rm(80, 12), [{ date: '2026-10-08', value: e1rm(80, 12) }]]);
  correctSet(db, plain.id, { unit: 'lb' });
  const lb = e1rm(80 / 0.45359237, 12);
  assert.deepEqual([progress(db, name).estimate?.value, workoutSummary(db, workout).exercises[0].estimate], [lb, lb]);
  assert.equal(progress(db, 'Bench Press').estimate?.value, e1rm(82.5, 8));
});

test('rep maxes invert the Epley estimate at 3, 5, 8 and 10 reps', () => {
  assert.deepEqual(repMaxes(e1rm(100, 5)).map((r) => [r.reps, Math.round(r.weight * 10) / 10]), [[3, 106.1], [5, 100], [8, 92.1], [10, 87.5]]);
});

test('home sections keep their stored order and visibility, appending unknown ones', () => {
  const db = openDb(':memory:');
  assert.deepEqual(homeLayout(db).map((s) => s.id), ['heatmap', 'muscles', 'stats', 'recent', 'templates', 'measurements']);
  setSetting(db, 'homeOrder', 'recent,stats');
  setSetting(db, 'homeHidden', 'muscles,stats');
  assert.deepEqual(homeLayout(db).map((s) => `${s.shown ? '' : '-'}${s.id}`), ['recent', '-stats', 'heatmap', '-muscles', 'templates', 'measurements']);
  assert.throws(() => setSetting(db, 'homeOrder', 'recent,start'), /Home order must be/);
  assert.throws(() => setSetting(db, 'homeHidden', 'stats,stats'), /Hidden home sections must be/);
});

test('a set shows its stored fields, else every field when its old options were open or used', () => {
  assert.deepEqual(shownFields({ fields: 'plates,rpe,bogus' }), ['rpe', 'plates']);
  assert.deepEqual(shownFields({ fields: '', options: true }), []);
  assert.deepEqual(shownFields({ options: true }), ['targetRpe', 'rpe', 'rest', 'comment', 'plates']);
  assert.deepEqual(shownFields({ rest: 90 }), ['targetRpe', 'rpe', 'rest', 'comment', 'plates']);
  assert.deepEqual(shownFields({ rest: 90, options: false }), []);
  assert.deepEqual(shownFields({}), []);
});

test('completing a set advances to the superset partner, then the next unfinished exercise', () => {
  const ex = (id: string, superset: string | null, ...done: boolean[]) => ({ id, superset, sets: done.map((completed) => ({ completed })) });
  const plan = (...items: ReturnType<typeof ex>[]) => items;
  assert.equal(advance(plan(ex('a', null, true, false), ex('b', null, false)), 'a'), 'a');
  assert.equal(advance(plan(ex('a', null, true, true), ex('b', null, false)), 'a'), 'b');
  assert.equal(advance(plan(ex('a', 's', true, false), ex('b', 's', false, false), ex('c', null, false)), 'a'), 'b');
  assert.equal(advance(plan(ex('a', 's', true, false), ex('b', 's', true, false), ex('c', null, false)), 'b'), 'a');
  assert.equal(advance(plan(ex('a', 's', true, false), ex('b', 's', true, true), ex('c', null, false)), 'b'), 'a');
  assert.equal(advance(plan(ex('a', 's', true, true), ex('b', 's', true, true), ex('c', null, false)), 'b'), 'c');
  assert.equal(advance(plan(ex('a', 's', true), ex('c', null, false), ex('b', 's', true)), 'b'), 'c');
  assert.equal(advance(plan(ex('a', null, false), ex('b', null, true), ex('c', null, true)), 'c'), 'a');
  assert.equal(advance(plan(ex('a', null, true), ex('b', null, true)), 'b'), null);
});

test('unusual flags a weight far from recent bests or reps far from the last set at that weight', () => {
  const set = (weight: number, reps: number, extra: object = {}) => ({ type: 'normal' as const, completed: true, weight, reps, ...extra });
  const recent = [[set(100, 5), set(60, 10, { type: 'warm-up' })], [set(95, 8), set(100, 6, { completed: false })]];
  assert.deepEqual(unusual(set(1000, 5), recent), { field: 'weight', usual: 100 });
  assert.equal(unusual(set(40, 5), recent)?.field, 'weight');
  assert.equal(unusual(set(150, 5), recent), null);
  assert.equal(unusual(set(50, 5), recent), null);
  assert.deepEqual(unusual(set(100, 15), recent), { field: 'reps', last: 5 });
  assert.equal(unusual(set(95, 2), recent)?.field, 'reps');
  assert.equal(unusual(set(100, 14), recent), null);
  assert.equal(unusual(set(97.5, 30), recent), null);
  assert.equal(unusual(set(220, 5, { unit: 'lb' }), recent), null);
  assert.equal(unusual(set(1000, 5, { type: 'warm-up' }), recent), null);
  assert.equal(unusual(set(30, 5, { type: 'drop' }), recent), null);
  assert.equal(unusual(set(1000, 5), []), null);
  assert.equal(unusual(set(100, 2), [[set(100, 10), set(100, 3)]]), null);
});
