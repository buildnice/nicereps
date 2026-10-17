import type { Db, Row, Value } from './db.ts';

export type Role = 'primary' | 'secondary';
export type SetType = 'normal' | 'warm-up' | 'drop';
export type Mapping = { muscle: string; role: Role }[];
export type Mode = 'reps' | 'duration' | 'distance' | 'interval' | 'check';
export type WeightUnit = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';
export type SetFields = {
  type: SetType;
  weight: number;
  unit?: WeightUnit;
  reps: number;
  targetReps?: number | null;
  completed: boolean;
  duration?: number | null;
  distance?: number | null;
  distanceUnit?: DistanceUnit;
  rounds?: number | null;
  recovery?: number | null;
  rest?: number | null;
  targetRpe?: number | null;
  rpe?: number | null;
  comment?: string | null;
  options?: boolean | null;
  fields?: string | null;
};

const setColumns = 'type, weight, unit, reps, target_reps, completed, duration, distance, distance_unit, rounds, recovery, rest, target_rpe, rpe, comment, options, fields';

const setValues = (s: SetFields): Value[] => [
  s.type,
  s.weight,
  s.unit ?? 'kg',
  s.reps,
  s.targetReps ?? null,
  Number(s.completed),
  s.duration ?? null,
  s.distance ?? null,
  s.distanceUnit ?? 'km',
  s.rounds ?? null,
  s.recovery ?? null,
  s.rest ?? null,
  s.targetRpe ?? null,
  s.rpe ?? null,
  s.comment ?? null,
  s.options == null ? null : Number(s.options),
  s.fields ?? null,
];

const toSet = (s: Row): SetFields => ({
  type: s.type as SetType,
  weight: s.weight as number,
  unit: s.unit as WeightUnit,
  reps: s.reps as number,
  targetReps: s.target_reps as number | null,
  completed: s.completed === 1,
  duration: s.duration as number | null,
  distance: s.distance as number | null,
  distanceUnit: s.distance_unit as DistanceUnit,
  rounds: s.rounds as number | null,
  recovery: s.recovery as number | null,
  rest: s.rest as number | null,
  targetRpe: s.target_rpe as number | null,
  rpe: s.rpe as number | null,
  comment: s.comment as string | null,
  options: s.options === null ? null : s.options === 1,
  fields: s.fields as string | null,
});

const one = (db: Db, sql: string, params: Value[]) => {
  const row = db.all(sql, params)[0];
  if (!row) throw new Error(`Not found: ${params[0]}`);
  return row;
};

export const readSetting = (db: Db, key: string) => db.all('SELECT value FROM setting WHERE key = ?', [key])[0]?.value as string | undefined;

export const writeSetting = (db: Db, key: string, value: string) =>
  db.run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

export const insertExercise = (db: Db, id: string, name: string, mode: Mode, rest: number, mapping: Mapping) => {
  db.run('INSERT INTO exercise (id, name, mode, rest) VALUES (?, ?, ?, ?)', [id, name, mode, rest]);
  replaceExerciseMapping(db, id, mapping);
};

export const replaceExerciseMapping = (db: Db, id: string, mapping: Mapping) => {
  one(db, 'SELECT id FROM exercise WHERE id = ?', [id]);
  db.run('DELETE FROM exercise_muscle WHERE exercise_id = ?', [id]);
  mapping.forEach((m) => db.run('INSERT INTO exercise_muscle (exercise_id, muscle, role) VALUES (?, ?, ?)', [id, m.muscle, m.role]));
};

export const exerciseId = (db: Db, name: string) => one(db, 'SELECT id FROM exercise WHERE name = ?', [name]).id as string;

export const exercises = (db: Db, query = '', limit = -1) => {
  const words = query.split(/\s+/).filter(Boolean).map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`);
  return db
    .all(`SELECT id, name, mode, source, bar, bar_unit FROM exercise WHERE ${['1', ...words.map(() => "name LIKE ? ESCAPE '\\'")].join(' AND ')} ORDER BY source IS NOT NULL, name LIMIT ?`, [
      ...words,
      limit,
    ])
    .map((e) => ({ id: e.id as string, name: e.name as string, mode: e.mode as Mode, source: e.source as string | null, bar: e.bar as number | null, barUnit: e.bar_unit as WeightUnit | null }));
};

export const templates = (db: Db) =>
  db
    .all('SELECT t.id, t.name, COUNT(te.id) AS count FROM template t LEFT JOIN template_exercise te ON te.template_id = t.id GROUP BY t.id ORDER BY t.name')
    .map((t) => ({ id: t.id as string, name: t.name as string, count: t.count as number }));

export const templateId = (db: Db, name: string) => one(db, 'SELECT id FROM template WHERE name = ?', [name]).id as string;

export const insertTemplate = (db: Db, id: string, name: string) => db.run('INSERT INTO template (id, name) VALUES (?, ?)', [id, name]);

export const resetTemplate = (db: Db, id: string, name: string) => {
  one(db, 'SELECT id FROM template WHERE id = ?', [id]);
  db.run('UPDATE template SET name = ? WHERE id = ?', [name, id]);
  db.run('DELETE FROM template_exercise WHERE template_id = ?', [id]);
};

export const deleteTemplate = (db: Db, id: string) => {
  one(db, 'SELECT id FROM template WHERE id = ?', [id]);
  db.run('DELETE FROM template WHERE id = ?', [id]);
};

export const insertTemplateExercise = (db: Db, id: string, templateId: string, exerciseId: string, position: number, superset: string | null = null) =>
  db.run('INSERT INTO template_exercise (id, template_id, exercise_id, position, superset) VALUES (?, ?, ?, ?, ?)', [id, templateId, exerciseId, position, superset]);

const templateSetColumns = 'type, weight, unit, reps, duration, distance, distance_unit, rounds, recovery, rest, target_rpe, options';

export const insertTemplateSet = (db: Db, id: string, templateExerciseId: string, position: number, set: Omit<SetFields, 'completed'>) =>
  db.run(`INSERT INTO template_set (id, template_exercise_id, position, ${templateSetColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    templateExerciseId,
    position,
    set.type,
    set.weight,
    set.unit ?? 'kg',
    set.reps,
    set.duration ?? null,
    set.distance ?? null,
    set.distanceUnit ?? 'km',
    set.rounds ?? null,
    set.recovery ?? null,
    set.rest ?? null,
    set.targetRpe ?? null,
    set.options == null ? null : Number(set.options),
  ]);

export const templatePlan = (db: Db, templateId: string) => {
  const name = one(db, 'SELECT name FROM template WHERE id = ?', [templateId]).name as string;
  const exercises = db
    .all('SELECT te.id, te.exercise_id, te.superset, e.name, e.mode, e.note FROM template_exercise te JOIN exercise e ON e.id = te.exercise_id WHERE te.template_id = ? ORDER BY te.position', [
      templateId,
    ])
    .map((e) => ({
      exerciseId: e.exercise_id as string,
      name: e.name as string,
      mode: e.mode as Mode,
      exerciseNote: e.note as string | null,
      superset: e.superset as string | null,
      sets: db.all(`SELECT ${templateSetColumns} FROM template_set WHERE template_exercise_id = ? ORDER BY position`, [e.id]).map((s): Omit<SetFields, 'completed' | 'rpe' | 'comment'> => ({
        type: s.type as SetType,
        weight: s.weight as number,
        unit: s.unit as WeightUnit,
        reps: s.reps as number,
        duration: s.duration as number | null,
        distance: s.distance as number | null,
        distanceUnit: s.distance_unit as DistanceUnit,
        rounds: s.rounds as number | null,
        recovery: s.recovery as number | null,
        rest: s.rest as number | null,
        targetRpe: s.target_rpe as number | null,
        options: s.options === null ? null : s.options === 1,
      })),
    }));
  return { id: templateId, name, exercises };
};

export const schedule = (db: Db) =>
  db
    .all('SELECT s.weekday, t.id, t.name FROM schedule s JOIN template t ON t.id = s.template_id')
    .map((s) => ({ weekday: s.weekday as string, id: s.id as string, name: s.name as string }));

export const writeSchedule = (db: Db, id: string, weekday: string, templateId: string | null) =>
  templateId
    ? db.run('INSERT INTO schedule (id, weekday, template_id) VALUES (?, ?, ?) ON CONFLICT(weekday) DO UPDATE SET template_id = excluded.template_id', [id, weekday, templateId])
    : db.run('DELETE FROM schedule WHERE weekday = ?', [weekday]);

export const scheduleChanges = (db: Db, from: string, to: string) =>
  db
    .all('SELECT c.date, t.id, t.name FROM schedule_change c LEFT JOIN template t ON t.id = c.template_id WHERE c.date BETWEEN ? AND ?', [from, to])
    .map((c) => ({ date: c.date as string, template: c.id === null ? null : { id: c.id as string, name: c.name as string } }));

export const writeScheduleChange = (db: Db, id: string, date: string, templateId: string | null) =>
  db.run('INSERT INTO schedule_change (id, date, template_id) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET template_id = excluded.template_id', [id, date, templateId]);

export const finishedDates = (db: Db, from: string, to: string) =>
  new Set(db.all('SELECT DISTINCT date FROM workout WHERE finished_at IS NOT NULL AND date BETWEEN ? AND ?', [from, to]).map((w) => w.date as string));

export const deleteScheduleChange = (db: Db, date: string) => db.run('DELETE FROM schedule_change WHERE date = ?', [date]);

export const insertWorkout = (db: Db, w: { id: string; templateId: string | null; name: string; date: string; timeZone: string; startedAt: string }) =>
  db.run('INSERT INTO workout (id, template_id, name, date, time_zone, started_at) VALUES (?, ?, ?, ?, ?, ?)', [
    w.id,
    w.templateId,
    w.name,
    w.date,
    w.timeZone,
    w.startedAt,
  ]);

export const insertWorkoutExercise = (db: Db, id: string, workoutId: string, exerciseId: string, superset: string | null = null) => {
  db.run(
    'INSERT INTO workout_exercise (id, workout_id, exercise_id, superset, position) SELECT ?, ?, ?, ?, COUNT(*) FROM workout_exercise WHERE workout_id = ?',
    [id, workoutId, exerciseId, superset, workoutId],
  );
  db.run('INSERT INTO workout_exercise_muscle (workout_exercise_id, muscle, role) SELECT ?, muscle, role FROM exercise_muscle WHERE exercise_id = ?', [
    id,
    exerciseId,
  ]);
};

export const insertSet = (db: Db, id: string, workoutExerciseId: string, set: SetFields) =>
  db.run(
    `INSERT INTO workout_set (id, workout_exercise_id, position, ${setColumns}) SELECT ?, ?, COUNT(*), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM workout_set WHERE workout_exercise_id = ?`,
    [id, workoutExerciseId, ...setValues(set), workoutExerciseId],
  );

export const readSet = (db: Db, id: string) => toSet(one(db, `SELECT ${setColumns} FROM workout_set WHERE id = ?`, [id]));

export const hasData = (db: Db) =>
  db.all('SELECT 1 WHERE EXISTS (SELECT 1 FROM workout WHERE finished_at IS NOT NULL) OR EXISTS (SELECT 1 FROM template) OR EXISTS (SELECT 1 FROM measurement) OR EXISTS (SELECT 1 FROM photo)', []).length > 0;

export const setPlace = (db: Db, id: string) => {
  const row = one(db, 'SELECT workout_exercise_id, position FROM workout_set WHERE id = ?', [id]);
  return { workoutExerciseId: row.workout_exercise_id as string, position: row.position as number };
};

export const updateSet = (db: Db, id: string, set: SetFields) =>
  db.run(`UPDATE workout_set SET (${setColumns}) = (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) WHERE id = ?`, [...setValues(set), id]);

export const lastSet = (db: Db, workoutExerciseId: string) => {
  const row =
    db.all(`SELECT ${setColumns} FROM workout_set WHERE workout_exercise_id = ? ORDER BY position DESC LIMIT 1`, [workoutExerciseId])[0] ??
    db.all(
      `SELECT ${setColumns} FROM workout_set WHERE id = (
         SELECT s.id FROM workout_set s
         JOIN workout_exercise we ON we.id = s.workout_exercise_id
         JOIN workout w ON w.id = we.workout_id
         JOIN workout_exercise this ON this.id = ? AND this.exercise_id = we.exercise_id
         JOIN workout current ON current.id = this.workout_id
         WHERE w.finished_at IS NOT NULL AND (w.date, w.started_at) < (current.date, current.started_at)
         ORDER BY w.date DESC, w.started_at DESC, s.type = 'warm-up', s.completed DESC, s.position LIMIT 1)`,
      [workoutExerciseId],
    )[0];
  return row && toSet(row);
};

const parents = { workout_exercise: 'workout_id', workout_set: 'workout_exercise_id' };

const siblings = (db: Db, table: keyof typeof parents, id: string) => {
  const ids = db
    .all(`SELECT id FROM ${table} WHERE ${parents[table]} = (SELECT ${parents[table]} FROM ${table} WHERE id = ?) ORDER BY position`, [id])
    .map((r) => r.id as string);
  if (!ids.includes(id)) throw new Error(`Not found: ${id}`);
  return ids;
};

export const renumber = (db: Db, table: keyof typeof parents, ids: string[]) => ids.forEach((id, i) => db.run(`UPDATE ${table} SET position = ? WHERE id = ?`, [i, id]));

export const deleteRow = (db: Db, table: keyof typeof parents, id: string) => {
  const ids = siblings(db, table, id);
  db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
  renumber(db, table, ids.filter((x) => x !== id));
};

export const moveRow = (db: Db, table: keyof typeof parents, id: string, to: number) => {
  const ids = siblings(db, table, id);
  if (!(Number.isInteger(to) && to >= 0 && to < ids.length)) throw new Error(`Invalid position: ${to}`);
  ids.splice(to, 0, ...ids.splice(ids.indexOf(id), 1));
  renumber(db, table, ids);
};

export const setBar = (db: Db, exerciseId: string, bar: number | null, unit: WeightUnit) => {
  if (one(db, 'SELECT mode FROM exercise WHERE id = ?', [exerciseId]).mode !== 'reps') throw new Error('Only weight × reps exercises have a bar');
  db.run('UPDATE exercise SET bar = ?, bar_unit = ? WHERE id = ?', [bar, bar == null ? null : unit, exerciseId]);
};

export const setNote = (db: Db, table: 'workout' | 'workout_exercise' | 'exercise', id: string, note: string | null) => {
  one(db, `SELECT id FROM ${table} WHERE id = ?`, [id]);
  db.run(`UPDATE ${table} SET note = ? WHERE id = ?`, [note, id]);
};

export const linkSuperset = (db: Db, a: string, b: string, newGroup: string) => {
  const [x, y] = [a, b].map((id) => one(db, 'SELECT workout_id, superset FROM workout_exercise WHERE id = ?', [id]));
  if (a === b || x.workout_id !== y.workout_id) throw new Error('Superset exercises must be different exercises in one workout');
  const group = (x.superset ?? newGroup) as string;
  db.run('UPDATE workout_exercise SET superset = ? WHERE id IN (?, ?) OR superset = ?', [group, a, b, y.superset]);
};

export const unlinkSuperset = (db: Db, id: string) => {
  const group = one(db, 'SELECT superset FROM workout_exercise WHERE id = ?', [id]).superset;
  db.run('UPDATE workout_exercise SET superset = NULL WHERE id = ?', [id]);
  db.run('UPDATE workout_exercise SET superset = NULL WHERE superset = ? AND (SELECT COUNT(*) FROM workout_exercise WHERE superset = ?) < 2', [group, group]);
};

export const deleteUnfinishedWorkout = (db: Db, id: string) => {
  if (one(db, 'SELECT finished_at FROM workout WHERE id = ?', [id]).finished_at !== null) throw new Error('Only an unfinished workout can be discarded');
  db.run('DELETE FROM workout WHERE id = ?', [id]);
};

export const deleteWorkout = (db: Db, id: string) => {
  one(db, 'SELECT id FROM workout WHERE id = ?', [id]);
  db.run('DELETE FROM workout WHERE id = ?', [id]);
};

export const finishWorkout = (db: Db, id: string, finishedAt: string) => {
  one(db, 'SELECT id FROM workout WHERE id = ?', [id]);
  db.run('UPDATE workout SET finished_at = COALESCE(finished_at, ?) WHERE id = ?', [finishedAt, id]);
};

export const renameWorkout = (db: Db, id: string, name: string) => {
  one(db, 'SELECT id FROM workout WHERE id = ?', [id]);
  db.run('UPDATE workout SET name = ? WHERE id = ?', [name, id]);
};

export const updateWorkoutDate = (db: Db, id: string, date: string) => {
  one(db, 'SELECT id FROM workout WHERE id = ?', [id]);
  db.run('UPDATE workout SET date = ? WHERE id = ?', [date, id]);
};

export const replaceWorkoutMapping = (db: Db, workoutExerciseId: string, mapping: Mapping) => {
  one(db, 'SELECT id FROM workout_exercise WHERE id = ?', [workoutExerciseId]);
  db.run('DELETE FROM workout_exercise_muscle WHERE workout_exercise_id = ?', [workoutExerciseId]);
  mapping.forEach((m) =>
    db.run('INSERT INTO workout_exercise_muscle (workout_exercise_id, muscle, role) VALUES (?, ?, ?)', [workoutExerciseId, m.muscle, m.role]),
  );
};

const groupBy = (rows: Row[], key: string) => {
  const groups = new Map<Value, Row[]>();
  for (const r of rows) groups.get(r[key])?.push(r) ?? groups.set(r[key], [r]);
  return groups;
};

export const workouts = (db: Db, where: string, params: Value[], limit = -1, exercise: string | null = null) => {
  const rows = db.all(`SELECT id, name, date, time_zone, started_at, finished_at, note FROM workout WHERE ${where} ORDER BY date DESC, started_at DESC LIMIT ?`, [...params, limit]);
  const ids = JSON.stringify(rows.map((w) => w.id));
  const exerciseRows = db.all(
    'SELECT we.id, we.workout_id, we.exercise_id, e.name, e.mode, e.rest, e.source, e.bar, e.bar_unit, e.note AS exercise_note, we.superset, we.note FROM workout_exercise we JOIN exercise e ON e.id = we.exercise_id WHERE we.workout_id IN (SELECT value FROM json_each(?)) AND (? IS NULL OR e.name = ?) ORDER BY we.position',
    [ids, exercise, exercise],
  );
  const exerciseIds = JSON.stringify(exerciseRows.map((e) => e.id));
  const mappings = groupBy(db.all('SELECT workout_exercise_id, muscle, role FROM workout_exercise_muscle WHERE workout_exercise_id IN (SELECT value FROM json_each(?)) ORDER BY role, muscle', [exerciseIds]), 'workout_exercise_id');
  const sets = groupBy(db.all(`SELECT id, workout_exercise_id, ${setColumns} FROM workout_set WHERE workout_exercise_id IN (SELECT value FROM json_each(?)) ORDER BY position`, [exerciseIds]), 'workout_exercise_id');
  const exercises = groupBy(exerciseRows, 'workout_id');
  return rows.map((w) => ({
    id: w.id as string,
    name: w.name as string,
    date: w.date as string,
    timeZone: w.time_zone as string,
    startedAt: w.started_at as string,
    finishedAt: w.finished_at as string | null,
    note: w.note as string | null,
    exercises: (exercises.get(w.id) ?? []).map((e) => ({
      id: e.id as string,
      exerciseId: e.exercise_id as string,
      name: e.name as string,
      mode: e.mode as Mode,
      rest: e.rest as number,
      source: e.source as string | null,
      bar: e.bar as number | null,
      barUnit: e.bar_unit as WeightUnit | null,
      exerciseNote: e.exercise_note as string | null,
      superset: e.superset as string | null,
      note: e.note as string | null,
      mapping: (mappings.get(e.id) ?? []).map((m) => ({ muscle: m.muscle as string, role: m.role as Role })),
      sets: (sets.get(e.id) ?? []).map((s) => ({ id: s.id as string, ...toSet(s) })),
    })),
  }));
};

export const muscleRows = (db: Db, from: string, to: string) =>
  db
    .all(
      `SELECT m.muscle, m.role, s.type, s.completed, e.name FROM workout w
       JOIN workout_exercise we ON we.workout_id = w.id
       JOIN exercise e ON e.id = we.exercise_id
       JOIN workout_exercise_muscle m ON m.workout_exercise_id = we.id
       JOIN workout_set s ON s.workout_exercise_id = we.id
       WHERE w.finished_at IS NOT NULL AND w.date >= ? AND w.date <= ?`,
      [from, to],
    )
    .map((r) => ({ muscle: r.muscle as string, role: r.role as Role, type: r.type as SetType, completed: r.completed === 1, exercise: r.name as string }));

export const setRows = (db: Db, from: string, to: string) =>
  db
    .all(
      `SELECT w.date, e.mode, e.source, s.type, s.completed, s.weight, s.unit, s.reps FROM workout w
       JOIN workout_exercise we ON we.workout_id = w.id
       JOIN exercise e ON e.id = we.exercise_id
       JOIN workout_set s ON s.workout_exercise_id = we.id
       WHERE w.finished_at IS NOT NULL AND w.date >= ? AND w.date <= ?`,
      [from, to],
    )
    .map((r) => ({ date: r.date as string, mode: r.mode as Mode, source: r.source as string | null, type: r.type as SetType, completed: r.completed === 1, weight: r.weight as number, unit: r.unit as WeightUnit, reps: r.reps as number }));

export const lifts = (db: Db) =>
  db
    .all(
      `SELECT e.id, e.name, e.mode, e.note FROM workout w
       JOIN workout_exercise we ON we.workout_id = w.id
       JOIN exercise e ON e.id = we.exercise_id
       JOIN workout_set s ON s.workout_exercise_id = we.id
       WHERE w.finished_at IS NOT NULL AND s.completed = 1 AND s.type != 'warm-up' AND e.mode IN ('reps', 'duration')
       GROUP BY e.name ORDER BY MAX(w.date) DESC, e.name`,
    )
    .map((r) => ({ id: r.id as string, name: r.name as string, mode: r.mode as Mode, note: r.note as string | null }));

export const starredRecords = (db: Db) => db.all('SELECT exercise_id, kind FROM starred_record').map((r) => `${r.exercise_id} ${r.kind}`);

export const exerciseMode = (db: Db, id: string) => one(db, 'SELECT mode FROM exercise WHERE id = ?', [id]).mode as Mode;

export const starRecord = (db: Db, id: string, exerciseId: string, kind: string, starred: boolean) => {
  if (starred) db.run('INSERT OR IGNORE INTO starred_record (id, exercise_id, kind) VALUES (?, ?, ?)', [id, exerciseId, kind]);
  else db.run('DELETE FROM starred_record WHERE exercise_id = ? AND kind = ?', [exerciseId, kind]);
};

export const measurementSeries = (db: Db) => db.all('SELECT id, name, preset, kind, method, starred FROM measurement_series ORDER BY rowid');

export const measurements = (db: Db) => db.all('SELECT id, series_id, date, value, unit FROM measurement ORDER BY date, rowid');

export const insertSeries = (db: Db, id: string, name: string, preset: string | null, kind: string, method: string | null) =>
  db.run('INSERT INTO measurement_series (id, name, preset, kind, method) VALUES (?, ?, ?, ?, ?)', [id, name, preset, kind, method]);

export const insertMeasurement = (db: Db, id: string, seriesId: string, date: string, value: number, unit: string) =>
  db.run('INSERT INTO measurement (id, series_id, date, value, unit) VALUES (?, ?, ?, ?, ?)', [id, seriesId, date, value, unit]);

export const updateMeasurement = (db: Db, id: string, value: number, unit: string, date: string) => {
  one(db, 'SELECT id FROM measurement WHERE id = ?', [id]);
  db.run('UPDATE measurement SET value = ?, unit = ?, date = ? WHERE id = ?', [value, unit, date, id]);
};

export const deleteMeasurement = (db: Db, id: string) => {
  one(db, 'SELECT id FROM measurement WHERE id = ?', [id]);
  db.run('DELETE FROM measurement WHERE id = ?', [id]);
};

export const deleteSeries = (db: Db, id: string) => {
  one(db, 'SELECT id FROM measurement_series WHERE id = ?', [id]);
  db.run('DELETE FROM measurement_series WHERE id = ?', [id]);
};

export const starSeries = (db: Db, id: string, starred: boolean) => {
  one(db, 'SELECT id FROM measurement_series WHERE id = ?', [id]);
  db.run('UPDATE measurement_series SET starred = ? WHERE id = ?', [starred ? 1 : 0, id]);
};

export const photos = (db: Db) => db.all('SELECT id, date, file FROM photo ORDER BY date, rowid');

export const insertPhoto = (db: Db, id: string, date: string, file: string) => db.run('INSERT INTO photo (id, date, file) VALUES (?, ?, ?)', [id, date, file]);

export const deletePhoto = (db: Db, id: string) => {
  const { file } = one(db, 'SELECT file FROM photo WHERE id = ?', [id]);
  db.run('DELETE FROM photo WHERE id = ?', [id]);
  return file as string;
};

export const finishedWorkouts = (db: Db) => db.all('SELECT id, name, date, time_zone, started_at, finished_at FROM workout WHERE finished_at IS NOT NULL ORDER BY date, started_at');

export const healthRecords = (db: Db) => db.all('SELECT id, kind, hash FROM health_record');

export const writeHealthRecord = (db: Db, id: string, kind: string, hash: string) =>
  db.run('INSERT INTO health_record (id, kind, hash) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, hash = excluded.hash', [id, kind, hash]);

export const deleteHealthRecord = (db: Db, id: string) => db.run('DELETE FROM health_record WHERE id = ?', [id]);

export const forgetHealthRecords = (db: Db) => db.run('DELETE FROM health_record');
