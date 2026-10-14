import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { strToU8, zipSync } from 'fflate';

import { openDb, readDb } from '../cli/db.ts';
import { matchExercises } from '../src/domain/apps.ts';
import { applyImport, parseCsv, previewImport, readImport } from '../src/domain/portability.ts';
import { createExercise, setSetting } from '../src/domain/workouts.ts';

const header = '"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"';
const strong = (lines: string[], head = header) => strToU8([head, ...lines].join('\n') + '\n');
const push = strong([
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Bench Press (Barbell)";"Note";"";"";"";"";"";"the whole "gym went quiet" day";""',
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Bench Press (Barbell)";"W";"40";"10";"";"";"";"";""',
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Bench Press (Barbell)";"1";"80";"5";"8";"";"";"paused";""',
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Bench Press (Barbell)";"D";"60";"8";"";"";"";"";""',
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Squat (Barbell)";"F";"100";"3";"";"";"";"";""',
  '"1";"2026-03-02 18:30:00";"Push 💪";"3600";"Rowing (Machine)";"1";"";"";"";"2000";"480";"";""',
]);
const count = (db: ReturnType<typeof openDb>, sql: string) => db.all(sql)[0].n;

test('exercise names match exactly, then by their words ignoring order, plurals and brackets', () => {
  const db = openDb(':memory:');
  createExercise(db, 'Tyre Flip Heavy', []);
  createExercise(db, 'Heavy Tyre Flips', []);
  const m = matchExercises(db, 'strong', ['leg press', 'Seated Row (Cable)', 'Squat (Barbell)', 'Bench Press (Barbell)', 'Flip - Heavy Tyre']);
  const name = (id: string | null) => id && db.all('SELECT name FROM exercise WHERE id = ?', [id])[0].name;
  assert.deepEqual(
    Object.values(m).map((x) => name(x.id)),
    ['Leg Press', 'Seated Cable Rows', 'Barbell Squat', null, null],
  );
});

test('a Strong workout CSV imports once every exercise name has a match, in the importing time zone', () => {
  const db = openDb(':memory:');
  const imp = readImport(db, [push], 'Australia/Sydney');
  assert.deepEqual(imp.errors, []);
  const preview = previewImport(db, imp);
  assert.deepEqual(preview.unmatched, ['Bench Press (Barbell)', 'Rowing (Machine)']);
  assert.deepEqual(
    preview.exercises.map((e) => [e.name, !!e.id, e.saved]),
    [['Bench Press (Barbell)', false, false], ['Squat (Barbell)', true, false], ['Rowing (Machine)', false, false]],
  );
  assert.throws(() => applyImport(db, imp, 'skip'), /match Bench Press \(Barbell\) to an exercise first/);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM workout'), 0);

  const bench = db.all("SELECT id FROM exercise WHERE name = 'Barbell Bench Press - Medium Grip'")[0].id as string;
  const applied = applyImport(db, imp, 'skip', {}, { 'Bench Press (Barbell)': bench, 'Rowing (Machine)': 'new' });
  assert.equal(applied.counts.workout_set.new, 5);
  assert.deepEqual({ ...db.all('SELECT name, date, time_zone, started_at, finished_at, note FROM workout')[0] }, {
    name: 'Push 💪',
    date: '2026-03-02',
    time_zone: 'Australia/Sydney',
    started_at: '2026-03-02T07:30:00.000Z',
    finished_at: '2026-03-02T08:30:00.000Z',
    note: null,
  });
  assert.deepEqual(
    db.all('SELECT e.name, x.note FROM workout_exercise x JOIN exercise e ON e.id = x.exercise_id ORDER BY x.position').map((r) => [r.name, r.note]),
    [['Barbell Bench Press - Medium Grip', 'the whole "gym went quiet" day'], ['Barbell Squat', null], ['Rowing (Machine)', null]],
  );
  assert.deepEqual(
    db.all('SELECT type, weight, unit, reps, rpe, comment, duration, distance, distance_unit FROM workout_set ORDER BY rowid').map((r) => Object.values(r)),
    [
      ['warm-up', 40, 'kg', 10, null, null, null, null, 'km'],
      ['normal', 80, 'kg', 5, 8, 'paused', null, null, 'km'],
      ['drop', 60, 'kg', 8, null, null, null, null, 'km'],
      ['normal', 100, 'kg', 3, null, null, null, null, 'km'],
      ['normal', 0, 'kg', 0, null, null, 480, 2, 'km'],
    ],
  );
  assert.equal(db.all("SELECT mode FROM exercise WHERE name = 'Rowing (Machine)'")[0].mode, 'distance');
  assert.ok(Number(count(db, 'SELECT COUNT(*) n FROM workout_exercise_muscle')) > 0);

  const again = previewImport(db, readImport(db, [push], 'Australia/Sydney'));
  assert.deepEqual(again.counts.workout, { new: 0, duplicates: 0, unchanged: 1 });
  assert.equal(again.counts.workout_set.new, 0);

  const next = readImport(db, [strong(['"2";"2026-03-05 07:00:00";"Push 💪";"60";"Bench Press (Barbell)";"1";"82.5";"5";"";"";"";"";""'])], 'Australia/Sydney');
  const remembered = previewImport(db, next);
  assert.deepEqual(remembered.unmatched, []);
  assert.deepEqual(remembered.exercises, [{ name: 'Bench Press (Barbell)', id: bench, exercise: 'Barbell Bench Press - Medium Grip', saved: true }]);
});

test('a Strong export in pounds and miles keeps its units, and an unknown layout is rejected', () => {
  const db = openDb(':memory:');
  const imperial = header.replace('Weight (kg)', 'Weight (lbs)').replace('Distance (meters)', 'Distance (miles)');
  const imp = readImport(db, [strong(['"1";"2026-03-02 18:30:00";"Legs";"60";"Leg Press";"1";"225";"10";"";"0.5";"";"";""'], imperial)], 'UTC');
  applyImport(db, imp, 'skip');
  assert.deepEqual({ ...db.all('SELECT weight, unit, distance, distance_unit FROM workout_set')[0] }, { weight: 225, unit: 'lb', distance: 0.5, distance_unit: 'mi' });

  const odd = readImport(db, [strong([], header.replace('Weight (kg)', 'Weight (stone)'))], 'UTC');
  assert.deepEqual(odd.errors, ['This Strong export is missing the columns Weight (kg or lbs)']);
  const bad = readImport(db, [strong(['"1";"02/03/2026";"Legs";"60";"Leg Press";"X";"heavy";"10";"";"";"";"";""'])], 'UTC');
  assert.deepEqual(bad.errors, ['Strong line 2: Date must be YYYY-MM-DD HH:MM:SS; unknown Set Order X; Weight (kg) must be a non-negative number']);
  const late = readImport(db, [strong(['"1";"2026-03-02 25:30:00";"Legs";"60";"Leg Press";"1";"100";"10";"";"";"";"";""'])], 'UTC');
  assert.deepEqual(late.errors, ['Strong line 2: Date must be YYYY-MM-DD HH:MM:SS']);
});

test('a new custom exercise cannot take an existing name, and only Strong files allow bare quotes', () => {
  const db = openDb(':memory:');
  const legs = readImport(db, [strong(['"1";"2026-03-02 18:30:00";"Legs";"60";"leg press";"1";"";"";"";"";"90";"";""'])], 'UTC');
  const preview = previewImport(db, legs, 'replace', {}, { 'leg press': 'new' });
  assert.ok(preview.errors.includes('An exercise named leg press already exists; match it instead'));
  assert.throws(() => applyImport(db, legs, 'replace', {}, { 'leg press': 'new' }));
  assert.equal(db.all("SELECT mode FROM exercise WHERE name = 'Leg Press'")[0].mode, 'reps');
  assert.equal(count(db, 'SELECT COUNT(*) n FROM app_exercise'), 0);
  assert.throws(() => parseCsv('a,"x"y,z"\n'), /Malformed CSV/);
  assert.deepEqual(parseCsv('a;"x"y;z"\n', ';'), [['a', 'x"y;z']]);
});

test('Strong measurement files map to presets or new series, keep the last entry per day, and import once', () => {
  const db = openDb(':memory:');
  const zip = zipSync({
    'weight.csv': strToU8('"Date";"Weight (kg)"\n"2026-03-01 08:00:00";82.10000000000001\n"2026-03-01 20:00:00";82.6\n"2026-03-02 08:00:00";81.9\n'),
    'left_bicep.csv': strToU8('"Date";"Left bicep (in)"\n"2026-03-01 08:00:00";15.5\n'),
    'upper_abs.csv': strToU8('"Date";"Upper abs (cm)"\n"2026-03-01 08:00:00";90\n'),
    'body_fat_percentage.csv': strToU8('"Date";"Body fat percentage"\n"2026-03-01 08:00:00";18\n'),
    'caloric_intake.csv': strToU8('"Date";"Caloric intake"\n'),
  });
  const imp = readImport(db, [zip], 'UTC');
  assert.deepEqual(imp.errors, []);
  assert.deepEqual(imp.skipped, ['Body fat percentage: 1 entry; nicereps has no measurement for it']);
  const applied = applyImport(db, imp, 'skip');
  assert.deepEqual(applied.counts.measurement, { new: 4, duplicates: 0, unchanged: 0 });
  assert.deepEqual(
    db.all('SELECT s.name, s.preset, m.date, m.value, m.unit FROM measurement m JOIN measurement_series s ON s.id = m.series_id ORDER BY s.name, m.date').map((r) => Object.values(r)),
    [
      ['Body weight', 'body-weight', '2026-03-01', 82.6, 'kg'],
      ['Body weight', 'body-weight', '2026-03-02', 81.9, 'kg'],
      ['Left bicep', 'left-upper-arm', '2026-03-01', 15.5, 'in'],
      ['Upper abs', null, '2026-03-01', 90, 'cm'],
    ],
  );
  const again = previewImport(db, readImport(db, [zip], 'UTC'));
  assert.deepEqual(again.counts.measurement, { new: 0, duplicates: 0, unchanged: 4 });
  assert.deepEqual(again.counts.measurement_series, { new: 0, duplicates: 0, unchanged: 0 });
});

const hevyHeader = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';
const hevy = (lines: string[], head = hevyHeader) => strToU8([head, ...lines].join('\r\n') + '\r\n');
const pull = hevy([
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Lat Pulldown (Cable)","0","grip, wide","0","warmup","30","12","","",""',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Lat Pulldown (Cable)","0","grip, wide","1","failure","60","8","","","9"',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Lat Pulldown (Cable)","0","grip, wide","2","dropset","45","10","","",""',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Squat (Barbell)","0","","0","normal","100","5","","","8.5"',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Plank","1","","0","normal","","","","60",""',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Running","","","0","normal","","","5.2","1800",""',
  '"Pull","2 Mar 2026, 18:30","2 Mar 2026, 19:30","felt strong","Squat (Barbell)","","","0","normal","110","3","","",""',
]);

test('a Hevy workout CSV imports set types, supersets, notes and modes, once', () => {
  const db = openDb(':memory:');
  const imp = readImport(db, [pull], 'Australia/Sydney');
  assert.deepEqual(imp.errors, []);
  assert.equal(imp.app, 'hevy');
  assert.throws(() => applyImport(db, imp, 'skip'), /match Lat Pulldown \(Cable\) to an exercise first/);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM workout'), 0);
  applyImport(db, imp, 'skip', {}, { 'Lat Pulldown (Cable)': 'new', Running: 'new' });
  assert.deepEqual({ ...db.all('SELECT name, date, started_at, finished_at, note FROM workout')[0] }, {
    name: 'Pull',
    date: '2026-03-02',
    started_at: '2026-03-02T07:30:00.000Z',
    finished_at: '2026-03-02T08:30:00.000Z',
    note: 'felt strong',
  });
  const rows = db.all('SELECT e.name, e.mode, x.note, x.superset FROM workout_exercise x JOIN exercise e ON e.id = x.exercise_id ORDER BY x.position');
  assert.deepEqual(
    rows.map((r) => [r.name, r.mode, r.note]),
    [['Lat Pulldown (Cable)', 'reps', 'grip, wide'], ['Barbell Squat', 'reps', null], ['Plank', 'duration', null], ['Running', 'distance', null], ['Barbell Squat', 'reps', null]],
  );
  assert.ok(rows[0].superset && rows[0].superset === rows[1].superset);
  assert.deepEqual(rows.slice(2).map((r) => r.superset), [null, null, null]);
  assert.deepEqual(
    db.all('SELECT type, weight, unit, reps, rpe, duration, distance, distance_unit FROM workout_set ORDER BY rowid').map((r) => Object.values(r)),
    [
      ['warm-up', 30, 'kg', 12, null, null, null, 'km'],
      ['normal', 60, 'kg', 8, 9, null, null, 'km'],
      ['drop', 45, 'kg', 10, null, null, null, 'km'],
      ['normal', 100, 'kg', 5, 8.5, null, null, 'km'],
      ['normal', 0, 'kg', 0, null, 60, null, 'km'],
      ['normal', 0, 'kg', 0, null, 1800, 5.2, 'km'],
      ['normal', 110, 'kg', 3, null, null, null, 'km'],
    ],
  );
  const again = previewImport(db, readImport(db, [pull], 'Australia/Sydney'));
  assert.deepEqual(again.counts.workout, { new: 0, duplicates: 0, unchanged: 1 });
  assert.equal(again.counts.workout_set.new, 0);
});

test('a Hevy export in pounds and miles keeps its units, and a bad row is rejected', () => {
  const db = openDb(':memory:');
  const imperial = hevyHeader.replace('weight_kg', 'weight_lbs').replace('distance_km', 'distance_miles');
  applyImport(db, readImport(db, [hevy(['"Legs","12 Oct 2026, 07:05","12 Oct 2026, 08:00","","Leg Press","","","0","normal","225","10","0.5","",""'], imperial)], 'UTC'), 'skip');
  assert.deepEqual({ ...db.all('SELECT weight, unit, distance, distance_unit FROM workout_set')[0] }, { weight: 225, unit: 'lb', distance: 0.5, distance_unit: 'mi' });
  assert.equal(db.all('SELECT started_at FROM workout')[0].started_at, '2026-10-12T07:05:00.000Z');

  const odd = readImport(db, [hevy([], hevyHeader.replace('weight_kg', 'weight_st'))], 'UTC');
  assert.deepEqual(odd.errors, ['This Hevy export is missing the columns weight_kg or weight_lbs']);
  const bad = readImport(db, [hevy(['"Legs","2026-10-12 07:05","31 Feb 2026, 08:00","","Leg Press","","","0","amrap","heavy","10","","",""'])], 'UTC');
  assert.deepEqual(bad.errors, ['Hevy line 2: start_time must be like 13 Oct 2026, 10:25; end_time must be like 13 Oct 2026, 10:25; unknown set_type amrap; weight_kg must be a non-negative number']);
});

test('a Hevy measurements CSV maps parts to presets or new series, skips body fat, and imports once', () => {
  const db = openDb(':memory:');
  const csv = (head: string, lines: string[]) => strToU8([head, ...lines].join('\r\n') + '\r\n');
  const metric = csv('"date","weight_kg","fat_percent","neck_cm","shoulder_cm","left_bicep_cm","waist_cm"', ['"1 Mar 2026, 00:00","83","18","","","",""', '"1 Mar 2026, 00:00","82.104","","","120","","86"', '"2 Mar 2026, 00:00","81.9","17.5","","","",""']);
  const imp = readImport(db, [metric], 'UTC');
  assert.deepEqual(imp.errors, []);
  assert.deepEqual(imp.skipped, ['Fat percent: 2 entries; nicereps has no measurement for it']);
  applyImport(db, imp, 'skip');
  const imperial = csv('"date","weight_lbs","fat_percent","left_bicep_in"', ['"3 Mar 2026, 00:00","180","",""', '"3 Mar 2026, 00:00","","","15.5"']);
  applyImport(db, readImport(db, [imperial], 'UTC'), 'skip');
  assert.deepEqual(
    db.all('SELECT s.name, s.preset, m.date, m.value, m.unit FROM measurement m JOIN measurement_series s ON s.id = m.series_id ORDER BY s.name, m.date').map((r) => Object.values(r)),
    [
      ['Body weight', 'body-weight', '2026-03-01', 82.1, 'kg'],
      ['Body weight', 'body-weight', '2026-03-02', 81.9, 'kg'],
      ['Body weight', 'body-weight', '2026-03-03', 180, 'lb'],
      ['Left bicep', 'left-upper-arm', '2026-03-03', 15.5, 'in'],
      ['Shoulder', null, '2026-03-01', 120, 'cm'],
      ['Waist', 'waist', '2026-03-01', 86, 'cm'],
    ],
  );
  const again = previewImport(db, readImport(db, [metric], 'UTC'));
  assert.deepEqual(again.counts.measurement, { new: 0, duplicates: 0, unchanged: 4 });
  assert.deepEqual(again.counts.measurement_series, { new: 0, duplicates: 0, unchanged: 0 });
  assert.deepEqual(readImport(db, [csv('"date","weight_kg","fat_percent"', ['"Mar 1 2026","80",""'])], 'UTC').errors, ['Hevy measurements line 2, weight_kg: expected a date and a positive value']);
});

const fitNotes = (extra: string[] = []) => {
  const path = join(mkdtempSync(join(tmpdir(), 'fitnotes-')), 'FitNotes_Backup.fitnotes');
  const file = new DatabaseSync(path);
  file.exec(
    [
      'PRAGMA user_version = 22',
      'CREATE TABLE Category(_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, colour INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0)',
      'CREATE TABLE exercise(_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category_id INTEGER NOT NULL, exercise_type_id INTEGER NOT NULL DEFAULT 0, notes TEXT, weight_increment INTEGER, default_graph_id INTEGER, default_rest_time INTEGER, weight_unit_id INTEGER NOT NULL DEFAULT 0, is_favourite INTEGER NOT NULL DEFAULT 0)',
      'CREATE TABLE training_log (_id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL, date DATE NOT NULL, metric_weight INTEGER NOT NULL, reps INTEGER NOT NULL, unit INTEGER NOT NULL DEFAULT 0, routine_section_exercise_set_id INTEGER NOT NULL DEFAULT 0, timer_auto_start INTEGER NOT NULL DEFAULT 0, is_personal_record INTEGER NOT NULL DEFAULT 0, is_personal_record_first INTEGER NOT NULL DEFAULT 0, is_complete INTEGER NOT NULL DEFAULT 0, is_pending_update INTEGER NOT NULL DEFAULT 0, distance INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER NOT NULL DEFAULT 0)',
      'CREATE TABLE Comment (_id INTEGER PRIMARY KEY AUTOINCREMENT, date DATE NOT NULL, owner_type_id INTEGER NOT NULL, owner_id INTEGER NOT NULL, comment TEXT NOT NULL)',
      'CREATE TABLE BodyWeight (_id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, body_weight_metric REAL NOT NULL, body_fat REAL NOT NULL, comments TEXT)',
      'CREATE TABLE WorkoutGroupExercise(_id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id INTEGER NOT NULL, date TEXT NOT NULL, routine_section_id INTEGER NOT NULL, workout_group_id INTEGER NOT NULL)',
      'CREATE TABLE WorkoutComment (_id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, comment TEXT NOT NULL)',
      'CREATE TABLE MeasurementUnit (_id INTEGER PRIMARY KEY AUTOINCREMENT, type INTEGER NOT NULL DEFAULT 0, long_name TEXT NOT NULL, short_name TEXT NOT NULL)',
      'CREATE TABLE Measurement (_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, unit_id INTEGER NOT NULL DEFAULT 0, goal_type INTEGER NOT NULL DEFAULT 0, goal_value REAL NOT NULL DEFAULT 0, custom INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0)',
      'CREATE TABLE MeasurementRecord (_id INTEGER PRIMARY KEY AUTOINCREMENT, measurement_id INTEGER NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, value REAL NOT NULL, comment TEXT)',
      'CREATE TABLE WorkoutTime (_id INTEGER PRIMARY KEY AUTOINCREMENT, workout_date TEXT NOT NULL, start_date_time TEXT NOT NULL, end_date_time TEXT NOT NULL)',
      'CREATE TABLE settings (_id INTEGER PRIMARY KEY AUTOINCREMENT, metric INTEGER NOT NULL DEFAULT 0)',
      'INSERT INTO settings (metric) VALUES (1)',
      "INSERT INTO Category (_id, name) VALUES (1, 'Chest'), (2, 'Cardio'), (3, 'Abs')",
      "INSERT INTO exercise (_id, name, category_id, exercise_type_id, weight_unit_id) VALUES (1, 'Flat Barbell Bench Press', 1, 0, 2), (2, 'Running (Outdoor)', 2, 1, 0), (3, 'Walking', 2, 1, 0), (4, 'Plank', 3, 3, 0), (5, 'Cable Crossover', 1, 0, 0)",
      "INSERT INTO training_log (_id, exercise_id, date, metric_weight, reps, unit, distance, duration_seconds) VALUES (1, 1, '2026-03-02', 102.0582833, 5, 0, 0, 0), (2, 5, '2026-03-02', 22.5, 12, 0, 0, 0), (3, 1, '2026-03-02', 102.0582833, 4, 0, 0, 0), (4, 2, '2026-03-02', 0, 0, 3, 5.2, 1800), (5, 3, '2026-03-03', 0, 0, 5, 1.5, 1500), (6, 4, '2026-03-03', 0, 0, 0, 0, 60), (7, 2, '2026-03-03', 0, 0, 2, 800, 240)",
      "INSERT INTO Comment (date, owner_type_id, owner_id, comment) VALUES ('2026-03-02', 1, 3, 'paused'), ('2026-03-02', 2, 1, 'workout-owned')",
      "INSERT INTO WorkoutComment (date, comment) VALUES ('2026-03-02', 'felt strong'), ('2026-03-02', 'gym was quiet')",
      "INSERT INTO WorkoutGroupExercise (exercise_id, date, routine_section_id, workout_group_id) VALUES (1, '2026-03-02', 0, 7), (5, '2026-03-02', 0, 7)",
      "INSERT INTO WorkoutTime (workout_date, start_date_time, end_date_time) VALUES ('2026-03-02', '2026-03-02T18:30:00+11:00', '2026-03-02T19:30:00+11:00')",
      "INSERT INTO MeasurementUnit (_id, type, long_name, short_name) VALUES (2, 1, 'Kilograms', 'kgs'), (3, 1, 'Pounds', 'lbs'), (4, 2, 'Centimetres', 'cm'), (6, 3, 'Percent', '%')",
      "INSERT INTO Measurement (_id, name, unit_id) VALUES (1, 'Bodyweight', 3), (2, 'Body Fat', 6), (6, 'Waist', 4), (9, 'Upper Arm (Left)', 4), (4, 'Shoulders', 4)",
      "INSERT INTO MeasurementRecord (measurement_id, date, time, value) VALUES (1, '2026-03-03', '07:00:00', 180.67), (2, '2026-03-03', '07:00:00', 18), (6, '2026-03-03', '07:05', 86), (9, '2026-03-03', '07:05:00', 35.5), (4, '2026-03-03', '07:05:00', 120)",
      "INSERT INTO BodyWeight (date, body_weight_metric, body_fat) VALUES ('2026-03-02', 82.3, 17.5)",
      ...extra,
    ].join(';\n'),
  );
  file.close();
  return path;
};
const fromFile = (db: ReturnType<typeof openDb>, path: string) => readImport(db, [readFileSync(path)], 'Australia/Sydney', undefined, () => readDb(path));

test('a FitNotes backup imports sets, units, comments, times, supersets and measurements, once', () => {
  const db = openDb(':memory:');
  const path = fitNotes();
  const imp = fromFile(db, path);
  assert.deepEqual(imp.errors, []);
  assert.equal(imp.app, 'fitnotes');
  assert.deepEqual(imp.skipped, ['Body fat: 2 entries; nicereps has no measurement for it']);
  assert.throws(() => applyImport(db, imp, 'skip'), /match Flat Barbell Bench Press to an exercise first/);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM workout'), 0);
  applyImport(db, imp, 'skip', {}, { 'Flat Barbell Bench Press': 'new', 'Running (Outdoor)': 'new', Walking: 'new' });
  assert.deepEqual(
    db.all('SELECT name, date, started_at, finished_at, note FROM workout ORDER BY date').map((r) => Object.values(r)),
    [
      ['Chest, Cardio', '2026-03-02', '2026-03-02T07:30:00.000Z', '2026-03-02T08:30:00.000Z', 'felt strong\ngym was quiet'],
      ['Cardio, Abs', '2026-03-03', '2026-03-03T12:00:00.000Z', '2026-03-03T12:00:00.000Z', null],
    ],
  );
  const rows = db.all('SELECT e.name, e.mode, x.superset FROM workout_exercise x JOIN exercise e ON e.id = x.exercise_id JOIN workout w ON w.id = x.workout_id ORDER BY w.date, x.position');
  assert.deepEqual(
    rows.map((r) => [r.name, r.mode]),
    [['Flat Barbell Bench Press', 'reps'], ['Cable Crossover', 'reps'], ['Running (Outdoor)', 'distance'], ['Walking', 'distance'], ['Plank', 'duration'], ['Running (Outdoor)', 'distance']],
  );
  assert.ok(rows[0].superset && rows[0].superset === rows[1].superset);
  assert.deepEqual(rows.slice(2).map((r) => r.superset), [null, null, null, null]);
  assert.deepEqual(
    db.all('SELECT s.type, s.weight, s.unit, s.reps, s.duration, s.distance, s.distance_unit, s.comment FROM workout_set s JOIN workout_exercise x ON x.id = s.workout_exercise_id JOIN workout w ON w.id = x.workout_id ORDER BY w.date, x.position, s.position').map((r) => Object.values(r)),
    [
      ['normal', 225, 'lb', 5, null, null, 'km', null],
      ['normal', 225, 'lb', 4, null, null, 'km', 'paused'],
      ['normal', 22.5, 'kg', 12, null, null, 'km', null],
      ['normal', 0, 'kg', 0, 1800, 5.2, 'km', null],
      ['normal', 0, 'kg', 0, 1500, 1.5, 'mi', null],
      ['normal', 0, 'kg', 0, 60, null, 'km', null],
      ['normal', 0, 'kg', 0, 240, 0.8, 'km', null],
    ],
  );
  assert.deepEqual(
    db.all('SELECT s.name, s.preset, m.date, m.value, m.unit FROM measurement m JOIN measurement_series s ON s.id = m.series_id ORDER BY s.name, m.date').map((r) => Object.values(r)),
    [
      ['Body weight', 'body-weight', '2026-03-02', 82.3, 'kg'],
      ['Body weight', 'body-weight', '2026-03-03', 81.95, 'kg'],
      ['Left bicep', 'left-upper-arm', '2026-03-03', 35.5, 'cm'],
      ['Shoulders', null, '2026-03-03', 120, 'cm'],
      ['Waist', 'waist', '2026-03-03', 86, 'cm'],
    ],
  );
  const again = previewImport(db, fromFile(db, path));
  assert.deepEqual(again.counts.workout, { new: 0, duplicates: 0, unchanged: 2 });
  assert.equal(again.counts.workout_set.new, 0);
  assert.deepEqual(again.counts.measurement, { new: 0, duplicates: 0, unchanged: 5 });
  assert.deepEqual(again.unmatched, []);
});

test('a FitNotes backup with a bad set, or another SQLite file, imports nothing', () => {
  const db = openDb(':memory:');
  const bad = fromFile(db, fitNotes(["INSERT INTO training_log (_id, exercise_id, date, metric_weight, reps) VALUES (8, 1, 'March 4', -5, 3)"]));
  assert.deepEqual(bad.errors, ['FitNotes set 8: date must be YYYY-MM-DD; metric_weight must be a non-negative number']);
  const other = join(mkdtempSync(join(tmpdir(), 'other-')), 'other.sqlite');
  new DatabaseSync(other).exec('CREATE TABLE t (x)');
  assert.deepEqual(fromFile(db, other).errors, ['This SQLite file is not a FitNotes backup']);
  assert.deepEqual(readImport(db, [readFileSync(other)], 'UTC').errors, ['This SQLite file is not a FitNotes backup']);
});

const slHeader = 'workout,start,end,exercise,specialset,weight,bodyweight,extraWeight,assistingWeight,distanceKM,reps,calories,time,warmup,max,fail,checked,setComment,workoutComment,form,sleep,calories,stress';
const strengthLog = (lines: string[], head = slHeader) => strToU8([head, ...lines].join('\r\n') + '\r\n');
const t0 = Date.UTC(2026, 2, 2, 14, 0);
const t1 = t0 + 3600_000;
const legs = strengthLog([
  `Legs,${t0},${t1},Squat (Barbell),,60,,,,,8,,,true,false,false,${t0},,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Squat (Barbell),,100,,,,,5,,,false,false,true,${t0},P5,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Leg Extension,superset,40,,,,,12,,,false,false,false,${t0},,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Seated Leg Curl,superset,35,,,,,10,,,false,false,false,${t0},,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Leg Extension,superset,40,,,,,0,,,false,false,false,,,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Seated Leg Curl,superset,35,,,,,9,,,false,false,false,${t0},,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Chin-Up,,0,100,10,,,6,,,false,false,false,${t0},,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Wide-grip pull-up,,,0,,23,,7,,,false,false,false,,8-10,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Plank,,0,,,,,,,00:01:30,false,false,false,,,"Deep, slow",9,7,5,10`,
  `Legs,${t0},${t1},Squat (Barbell),,110,,,,,3,,,false,false,false,${t0},,"Deep, slow",9,7,5,10`,
]);

test('a StrengthLog CSV imports sets, supersets, bodyweight loads and holds in the importing time zone, once', () => {
  const db = openDb(':memory:');
  const imp = readImport(db, [legs], 'Australia/Sydney');
  assert.deepEqual(imp.errors, []);
  assert.equal(imp.app, 'strengthlog');
  assert.deepEqual(imp.notes, ["Weights are read as kg, the weight unit in Settings: StrengthLog's export does not say which unit it used"]);
  assert.throws(() => applyImport(db, imp, 'skip'), /match Wide-grip pull-up to an exercise first/);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM workout'), 0);
  applyImport(db, imp, 'skip', {}, { 'Wide-grip pull-up': 'new' });
  assert.deepEqual({ ...db.all('SELECT name, date, started_at, finished_at, note FROM workout')[0] }, {
    name: 'Legs',
    date: '2026-03-03',
    started_at: '2026-03-02T14:00:00.000Z',
    finished_at: '2026-03-02T15:00:00.000Z',
    note: 'Deep, slow',
  });
  const rows = db.all('SELECT e.name, e.mode, x.superset FROM workout_exercise x JOIN exercise e ON e.id = x.exercise_id ORDER BY x.position');
  assert.deepEqual(
    rows.map((r) => [r.name, r.mode]),
    [['Barbell Squat', 'reps'], ['Leg Extensions', 'reps'], ['Seated Leg Curl', 'reps'], ['Chin-Up', 'reps'], ['Wide-grip pull-up', 'reps'], ['Plank', 'duration'], ['Barbell Squat', 'reps']],
  );
  assert.ok(rows[1].superset && rows[1].superset === rows[2].superset);
  assert.deepEqual([rows[0], ...rows.slice(3)].map((r) => r.superset), [null, null, null, null, null]);
  assert.deepEqual(
    db.all('SELECT type, weight, unit, reps, duration, comment, completed FROM workout_set ORDER BY rowid').map((r) => Object.values(r)),
    [
      ['warm-up', 60, 'kg', 8, null, null, 1],
      ['normal', 100, 'kg', 5, null, 'P5', 1],
      ['normal', 40, 'kg', 12, null, null, 1],
      ['normal', 35, 'kg', 10, null, null, 1],
      ['normal', 40, 'kg', 0, null, null, 0],
      ['normal', 35, 'kg', 9, null, null, 1],
      ['normal', 10, 'kg', 6, null, null, 1],
      ['normal', 0, 'kg', 7, null, '8-10; assisted 23 kg', 1],
      ['normal', 0, 'kg', 0, 90, null, 1],
      ['normal', 110, 'kg', 3, null, null, 1],
    ],
  );
  const again = previewImport(db, readImport(db, [legs], 'Australia/Sydney'));
  assert.deepEqual(again.counts.workout, { new: 0, duplicates: 0, unchanged: 1 });
  assert.equal(again.counts.workout_set.new, 0);
  assert.deepEqual(again.unmatched, []);
});

test('a StrengthLog export reads weights in the Settings unit, and a bad row is rejected', () => {
  const db = openDb(':memory:');
  setSetting(db, 'weightUnit', 'lb');
  const imp = readImport(db, [strengthLog([`Legs,${t0},${t1},Leg Press,,225,,,,,10,,,false,false,false,,,,,,,`])], 'UTC');
  assert.match(imp.notes![0], /^Weights are read as lb/);
  applyImport(db, imp, 'skip');
  assert.deepEqual({ ...db.all('SELECT weight, unit, reps FROM workout_set')[0] }, { weight: 225, unit: 'lb', reps: 10 });

  const odd = readImport(db, [strengthLog([], slHeader.replace('extraWeight', 'extra'))], 'UTC');
  assert.deepEqual(odd.errors, ['This StrengthLog export is missing the columns extraWeight']);
  const bad = readImport(db, [strengthLog([`Legs,2026-03-02,${t0},Leg Press,giant,heavy,,,,,10,,1:30,maybe,false,false,,,,,,,`, 'Legs,1e20,1e20,Leg Press,,60,,,,,10,,,false,false,false,,,,,,,'])], 'UTC');
  assert.deepEqual(bad.errors, ['StrengthLog line 2: start must be epoch milliseconds; end must be epoch milliseconds after start; unknown specialset giant; time must be HH:MM:SS; warmup must be true or false; start must be a non-negative number; weight must be a non-negative number', 'StrengthLog line 3: start must be epoch milliseconds; end must be epoch milliseconds after start']);
});
