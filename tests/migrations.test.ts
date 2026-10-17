import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { catalog } from '../assets/catalog/exercises.ts';
import { openDb } from '../cli/db.ts';
import { migrations } from '../src/data/schema.ts';
import { addSet, createExercise, getSetting, getWorkout, listExercises } from '../src/domain/workouts.ts';

const version = (db: ReturnType<typeof openDb>) => db.all('PRAGMA user_version')[0].user_version;

test('fresh database migrates to the latest version', () => {
  const db = openDb(':memory:');
  assert.equal(version(db), migrations.length);
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
  assert.deepEqual(tables, [
    'app_exercise',
    'exercise',
    'exercise_muscle',
    'health_record',
    'measurement',
    'measurement_series',
    'photo',
    'schedule',
    'schedule_change',
    'setting',
    'starred_record',
    'template',
    'template_exercise',
    'template_set',
    'workout',
    'workout_exercise',
    'workout_exercise_muscle',
    'workout_set',
  ]);
});

test('step 1 database keeps its stored theme and migrates once', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'legacy.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec("CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); INSERT INTO setting VALUES ('scheme', 'light')");
  legacy.close();

  assert.equal(getSetting(openDb(file), 'scheme'), 'light');
  const reopened = openDb(file);
  assert.equal(version(reopened), migrations.length);
  assert.equal(getSetting(reopened, 'scheme'), 'light');
});

test('foreign keys are enforced', () => {
  assert.throws(() => addSet(openDb(':memory:'), 'missing', { type: 'normal', weight: 1, reps: 1 }), /FOREIGN KEY/);
});

test('a newer database is refused', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'newer.sqlite');
  const newer = new DatabaseSync(file);
  newer.exec(`PRAGMA user_version = ${migrations.length + 1}`);
  newer.close();
  assert.throws(() => openDb(file), /newer than this app/);
});

test('step 3 slice 2 database gains the catalog and keeps its data', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'v2.sqlite');
  const v2 = new DatabaseSync(file);
  (migrations.slice(0, 2) as string[][]).flat().forEach((sql) => v2.exec(sql));
  v2.exec(`PRAGMA user_version = 2;
    INSERT INTO exercise (id, name, mode, rest) VALUES ('mine', 'Plank', 'check', 90);
    INSERT INTO exercise_muscle VALUES ('mine', 'core', 'primary');
    INSERT INTO workout (id, name, date, time_zone, started_at) VALUES ('w', 'Workout', '2026-10-09', 'UTC', '2026-10-09T00:00:00Z');
    INSERT INTO workout_exercise (id, workout_id, exercise_id, position) VALUES ('we', 'w', 'mine', 0);
    INSERT INTO workout_set (id, workout_exercise_id, position, type, weight, reps, duration) VALUES ('s', 'we', 0, 'normal', 0, 0, 45)`);
  v2.close();

  const db = openDb(file);
  assert.equal(version(db), migrations.length);
  const rows = (sql: string) => db.all(sql).map((r) => ({ ...r }));
  assert.deepEqual(rows("SELECT id, mode, rest, source FROM exercise WHERE name = 'Plank'"), [{ id: 'mine', mode: 'check', rest: 90, source: null }]);
  assert.deepEqual(rows("SELECT muscle FROM exercise_muscle WHERE exercise_id = 'mine'"), [{ muscle: 'core' }]);
  assert.equal(getWorkout(db, 'w').exercises[0].sets[0].duration, 45);
  assert.equal(db.all('SELECT COUNT(*) AS n FROM exercise WHERE source IS NOT NULL')[0].n, Object.keys(catalog).length - 1);
  assert.deepEqual(rows("SELECT muscle, role FROM exercise_muscle m JOIN exercise e ON e.id = m.exercise_id WHERE e.source = 'Romanian_Deadlift' ORDER BY role, muscle"), [
    ...catalog.Romanian_Deadlift.primary.map((muscle) => ({ muscle, role: 'primary' })),
    ...catalog.Romanian_Deadlift.secondary.map((muscle) => ({ muscle, role: 'secondary' })),
  ].sort((a, b) => a.role.localeCompare(b.role) || a.muscle.localeCompare(b.muscle)));
});

test('exercise search matches every word, lists custom exercises first and treats wildcards literally', () => {
  const db = openDb(':memory:');
  createExercise(db, 'Zercher Bench 100%', []);
  const names = (query: string) => listExercises(db, query).map((e) => e.name);
  assert.equal(names('bench')[0], 'Zercher Bench 100%');
  assert.ok(names('bench').length > 1);
  assert.ok(names('barbell bench').length > 1 && names('BARBELL bench').every((n) => /barbell/i.test(n) && /bench/i.test(n)));
  assert.deepEqual(names('100%'), ['Zercher Bench 100%']);
  assert.deepEqual(names('_'), []);
  assert.equal(listExercises(db, '', 5).length, 5);
});
