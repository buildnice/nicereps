import { createId } from '@paralleldrive/cuid2';

import { catalog } from '../../assets/catalog/exercises.ts';
import { transaction, type Db } from './db.ts';

export const seedCatalog = (db: Db) =>
  Object.entries(catalog).forEach(([source, e]) => {
    db.run('INSERT OR IGNORE INTO exercise (id, name, mode, source) VALUES (?, ?, ?, ?)', [
      createId(),
      e.name,
      e.mode,
      source,
    ]);
    [...e.primary.map((m) => [m, 'primary']), ...e.secondary.map((m) => [m, 'secondary'])].forEach(([muscle, role]) =>
      db.run('INSERT INTO exercise_muscle (exercise_id, muscle, role) SELECT id, ?, ? FROM exercise WHERE source = ?', [muscle, role, source]),
    );
  });

export const migrations: (string[] | ((db: Db) => void))[] = [
  [
    'CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    'CREATE TABLE exercise (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE)',
    `CREATE TABLE exercise_muscle (
      exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
      muscle TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
      PRIMARY KEY (exercise_id, muscle))`,
    'CREATE TABLE template (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)',
    `CREATE TABLE template_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES template(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      position INTEGER NOT NULL)`,
    `CREATE TABLE template_set (
      id TEXT PRIMARY KEY NOT NULL,
      template_exercise_id TEXT NOT NULL REFERENCES template_exercise(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('normal', 'warm-up', 'drop')),
      weight REAL NOT NULL,
      reps INTEGER NOT NULL)`,
    `CREATE TABLE workout (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT REFERENCES template(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT)`,
    'CREATE INDEX workout_date ON workout(date)',
    `CREATE TABLE workout_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      workout_id TEXT NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      position INTEGER NOT NULL)`,
    `CREATE TABLE workout_exercise_muscle (
      workout_exercise_id TEXT NOT NULL REFERENCES workout_exercise(id) ON DELETE CASCADE,
      muscle TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
      PRIMARY KEY (workout_exercise_id, muscle))`,
    `CREATE TABLE workout_set (
      id TEXT PRIMARY KEY NOT NULL,
      workout_exercise_id TEXT NOT NULL REFERENCES workout_exercise(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('normal', 'warm-up', 'drop')),
      weight REAL NOT NULL,
      reps INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)))`,
  ],
  [
    "ALTER TABLE exercise ADD COLUMN mode TEXT NOT NULL DEFAULT 'reps' CHECK (mode IN ('reps', 'duration', 'distance', 'interval', 'check'))",
    'ALTER TABLE exercise ADD COLUMN rest INTEGER NOT NULL DEFAULT 120',
    'ALTER TABLE workout ADD COLUMN note TEXT',
    'ALTER TABLE workout_exercise ADD COLUMN superset TEXT',
    'ALTER TABLE workout_exercise ADD COLUMN note TEXT',
    'ALTER TABLE workout_set ADD COLUMN duration INTEGER',
    'ALTER TABLE workout_set ADD COLUMN distance REAL',
    'ALTER TABLE workout_set ADD COLUMN rounds INTEGER',
    'ALTER TABLE workout_set ADD COLUMN recovery INTEGER',
    'ALTER TABLE workout_set ADD COLUMN rest INTEGER',
    'ALTER TABLE workout_set ADD COLUMN target_rpe REAL',
    'ALTER TABLE workout_set ADD COLUMN rpe REAL',
    'ALTER TABLE workout_set ADD COLUMN comment TEXT',
    'ALTER TABLE workout_set ADD COLUMN options INTEGER CHECK (options IN (0, 1))',
  ],
  (db) => {
    db.run('ALTER TABLE exercise ADD COLUMN source TEXT');
    db.run('CREATE UNIQUE INDEX exercise_source ON exercise(source)');
    seedCatalog(db);
  },
  [
    'ALTER TABLE template_exercise ADD COLUMN superset TEXT',
    ...['duration INTEGER', 'distance REAL', 'rounds INTEGER', 'recovery INTEGER', 'rest INTEGER', 'target_rpe REAL', 'options INTEGER CHECK (options IN (0, 1))'].map(
      (column) => `ALTER TABLE template_set ADD COLUMN ${column}`,
    ),
  ],
  [
    `CREATE TABLE schedule (
      id TEXT PRIMARY KEY NOT NULL,
      weekday TEXT NOT NULL UNIQUE CHECK (weekday IN ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
      template_id TEXT NOT NULL REFERENCES template(id) ON DELETE CASCADE)`,
    `CREATE TABLE schedule_change (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL UNIQUE,
      template_id TEXT REFERENCES template(id) ON DELETE SET NULL)`,
  ],
  [
    `CREATE TABLE measurement_series (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      preset TEXT UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('weight', 'length')),
      method TEXT)`,
    `CREATE TABLE measurement (
      id TEXT PRIMARY KEY NOT NULL,
      series_id TEXT NOT NULL REFERENCES measurement_series(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      value REAL NOT NULL CHECK (value > 0),
      unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb', 'cm', 'in')))`,
    'CREATE INDEX measurement_series_date ON measurement(series_id, date)',
  ],
  ['workout_set', 'template_set'].map((table) => `ALTER TABLE ${table} ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb'))`),
  [
    'CREATE TABLE photo (id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, file TEXT NOT NULL UNIQUE)',
    'ALTER TABLE measurement_series ADD COLUMN starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1))',
  ],
  ['workout_set', 'template_set'].map((table) => `ALTER TABLE ${table} ADD COLUMN distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi'))`),
  ['ALTER TABLE workout_set ADD COLUMN target_reps INTEGER', "DELETE FROM setting WHERE key = 'weekStart'"],
  ['ALTER TABLE exercise ADD COLUMN bar REAL', "ALTER TABLE exercise ADD COLUMN bar_unit TEXT CHECK (coalesce(bar > 0 AND bar_unit IN ('kg', 'lb'), bar IS NULL AND bar_unit IS NULL))"],
  [
    'CREATE INDEX workout_exercise_workout ON workout_exercise(workout_id, position)',
    'CREATE INDEX workout_exercise_exercise ON workout_exercise(exercise_id)',
    'CREATE INDEX workout_set_exercise ON workout_set(workout_exercise_id, position)',
    'CREATE INDEX template_exercise_template ON template_exercise(template_id, position)',
    'CREATE INDEX template_set_exercise ON template_set(template_exercise_id, position)',
  ],
  ['ALTER TABLE workout_set ADD COLUMN fields TEXT'],
  [
    `CREATE TABLE starred_record (
      id TEXT PRIMARY KEY,
      exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('weight', 'e1rm', 'hold')),
      UNIQUE (exercise_id, kind))`,
  ],
  [
    `CREATE TABLE app_exercise (
      app TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
      PRIMARY KEY (app, name))`,
  ],
  ["CREATE TABLE health_record (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('workout', 'weight')), hash TEXT NOT NULL)"],
];

export const migrate = (db: Db) => {
  db.run('PRAGMA foreign_keys = ON');
  const version = db.all('PRAGMA user_version')[0].user_version as number;
  if (version > migrations.length) throw new Error(`Database version ${version} is newer than this app (${migrations.length})`);
  migrations.slice(version).forEach((step, i) =>
    transaction(db, () => {
      if (typeof step === 'function') step(db);
      else step.forEach((sql) => db.run(sql));
      db.run(`PRAGMA user_version = ${version + i + 1}`);
    }),
  );
};
