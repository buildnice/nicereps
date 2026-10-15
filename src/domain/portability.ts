import { isCuid, createId } from '@paralleldrive/cuid2';
import { strFromU8, strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import { transaction, type Db, type Row, type Value } from '../data/db.ts';
import { migrations, seedCatalog } from '../data/schema.ts';
import { forgetHealth } from './health.ts';
import { photoName } from './measurements.ts';
import { isDate, localDate, optionalFields } from './rules.ts';
import { badSetting } from './workouts.ts';
import { fromFitNotes, fromHevy, fromHevyMeasurements, fromStrengthLog, fromStrong, fromStrongMeasurements, isFitNotes, isHevy, isHevyMeasurements, isStrengthLog, isStrong, isStrongMeasurements, resolveExercises, type Found, type Match } from './apps.ts';

const deviceSettings = new Set(['backupFolder', 'backupAt', 'backupError', 'backupDismissedAt', 'exportedAt', 'health', 'healthAt', 'healthError']);

export const format = { name: 'nicereps', version: 1 };

const tables = (db: Db) => db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('app_exercise', 'health_record') ORDER BY rowid").map((t) => t.name as string);

const formula = /^'*[=+\-@\t\r]/;

const quote = (v: string) => (/^$|[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

const cell = (v: Value) => (v === null ? '' : typeof v === 'number' ? String(v) : quote(formula.test(v) ? `'${v}` : v));

export const toCsv = (columns: string[], rows: Record<string, Value>[]) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].map((line) => `${line}\r\n`).join('');

export const parseCsv = (text: string, separator = ',') => {
  const field = new RegExp(`(?:"((?:[^"]|""${separator === ';' ? `|"(?!;|\\r?\\n|$)` : ''})*)"|([^${separator}"\\r\\n]*))(${separator}|\\r?\\n|$)`, 'y');
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  while (field.lastIndex < text.length) {
    const at = field.lastIndex;
    const m = field.exec(text);
    if (!m) throw new Error(`Malformed CSV at character ${at}`);
    const v = m[1] !== undefined ? m[1].replaceAll('""', '"') : m[2] || null;
    row.push(v && v[0] === "'" && formula.test(v) ? v.slice(1) : v);
    if (m[3] !== separator) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push([...row, null]);
  return rows;
};

export const exportArchive = async (db: Db, readPhoto: (file: string) => Uint8Array | null, write: (chunk: Uint8Array) => void, now = new Date()) => {
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    write(chunk);
  });
  const add = (name: string, data: Uint8Array, stored = false) => {
    const entry = stored ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(data, true);
  };
  const counts: Record<string, number> = {};
  for (const table of tables(db)) {
    const rows = db.all(`SELECT * FROM ${table} ORDER BY rowid`).filter((r) => table !== 'setting' || !deviceSettings.has(r.key as string));
    counts[table] = rows.length;
    add(`${table}.csv`, strToU8(toCsv(db.all(`PRAGMA table_info(${table})`).map((c) => c.name as string), rows)));
  }
  const files = db.all('SELECT file FROM photo ORDER BY rowid').map((p) => p.file as string);
  const photos: string[] = [];
  for (const file of files) {
    await new Promise((resolve) => setTimeout(resolve));
    const bytes = photoName.test(file) && readPhoto(file);
    if (bytes) {
      add(`photos/${file}`, bytes, true);
      photos.push(file);
    }
  }
  add('manifest.json', strToU8(JSON.stringify({ format: format.name, version: format.version, schema: migrations.length, exportedAt: now.toISOString(), tables: counts, photos }, null, 2)));
  zip.end();
  return { tables: counts, photos: photos.length, missing: files.filter((f) => !photos.includes(f)) };
};

export const eraseAll = (db: Db) =>
  transaction(db, () => {
    const files = db.all('SELECT file FROM photo').map((p) => p.file as string).filter((file) => photoName.test(file));
    tables(db)
      .reverse()
      .forEach((table) => db.run(`DELETE FROM ${table}`));
    forgetHealth(db);
    seedCatalog(db);
    return files;
  });

export const maxImportText = 64 * 1024 * 1024;

export const templateColumns = ['date', 'workout', 'exercise', 'type', 'weight', 'unit', 'reps', 'duration', 'distance', 'rounds', 'recovery', 'rest', 'rpe', 'comment'];

export const blankTemplate = toCsv(templateColumns, [
  { date: '2026-01-05', workout: 'Push', exercise: 'Barbell Bench Press - Medium Grip', type: 'warm-up', weight: 40, unit: 'kg', reps: 10, duration: null, distance: null, rounds: null, recovery: null, rest: 90, rpe: null, comment: null },
  { date: '2026-01-05', workout: 'Push', exercise: 'Barbell Bench Press - Medium Grip', type: 'normal', weight: 80, unit: 'kg', reps: 5, duration: null, distance: null, rounds: null, recovery: null, rest: 180, rpe: 8, comment: 'paused' },
]);

export type Parsed = { table: string; columns: string[]; rows: { at: string; cells: (string | null)[] }[] };
export type Import = { tables: Parsed[]; errors: string[]; app?: string; exercises?: Found[]; skipped?: string[]; notes?: string[] };
export type Action = 'skip' | 'update' | 'replace';
export type Duplicate = { key: string; table: string; label: string };
export type Preview = { counts: Record<string, { new: number; duplicates: number; unchanged: number }>; duplicates: Duplicate[]; errors: string[]; exercises: Match[]; unmatched: string[] };

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

export type PhotoSink = (file: string) => (data: Uint8Array, final: boolean) => void;

const unpack = (chunks: Iterable<Uint8Array>, errors: string[], photos: Set<string>, photo?: PhotoSink) => {
  const files: Record<string, Uint8Array[]> = {};
  let total = 0;
  const unzip = new Unzip((file) => {
    const name = file.name.slice(7);
    if (file.name.startsWith('photos/') && photoName.test(name)) {
      if (!photo) return;
      if (photos.has(name)) return void errors.push(`Repeated file in archive: ${file.name}`);
      photos.add(name);
      const write = photo(name);
      file.ondata = (error, data, final) => {
        if (error) throw error;
        write(data, final);
      };
      return file.start();
    }
    if (files[file.name]) return void errors.push(`Repeated file in archive: ${file.name}`);
    const parts: Uint8Array[] = (files[file.name] = []);
    file.ondata = (error, data) => {
      if (error) throw error;
      if ((total += data.length) > maxImportText) throw new Error('The archive holds more than 64 MB of tables');
      parts.push(data);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (const chunk of chunks) unzip.push(chunk);
  unzip.push(new Uint8Array(0), true);
  return Object.fromEntries(Object.entries(files).map(([name, parts]) => [name, strFromU8(concat(parts))]));
};

const fromTemplate = (db: Db, rows: (string | null)[][], timeZone: string, errors: string[]): Parsed[] => {
  const [header, ...lines] = rows;
  const unknown = header.filter((c) => !templateColumns.includes(c ?? ''));
  if (unknown.length) return errors.push(`Unknown template columns: ${unknown.join(', ')}`), [];
  const exercises = new Map(db.all('SELECT id, name FROM exercise').map((e) => [(e.name as string).toLowerCase(), e.id as string]));
  const today = localDate(new Date(), timeZone);
  const workouts = new Map<string, { id: string; exercises: Map<string, string> }>();
  const out: Record<string, Parsed> = Object.fromEntries(
    [
      ['workout', ['id', 'name', 'date', 'time_zone', 'started_at', 'finished_at']],
      ['workout_exercise', ['id', 'workout_id', 'exercise_id', 'position']],
      ['workout_exercise_muscle', ['workout_exercise_id', 'muscle', 'role']],
      ['workout_set', ['id', 'workout_exercise_id', 'position', 'type', 'weight', 'unit', 'reps', 'duration', 'distance', 'rounds', 'recovery', 'rest', 'rpe', 'comment', 'completed']],
    ].map(([table, columns]) => [table, { table: table as string, columns: columns as string[], rows: [] }]),
  );
  lines.forEach((cells, i) => {
    const at = `template line ${i + 2}`;
    const r = Object.fromEntries(templateColumns.map((c) => [c, cells[header.indexOf(c)] ?? null]));
    if (!r.date || !isDate(r.date) || r.date > today) return errors.push(`${at}: date must be a past YYYY-MM-DD date`);
    if (!r.workout) return errors.push(`${at}: workout name is required`);
    const exerciseId = exercises.get(r.exercise?.toLowerCase() ?? '');
    if (!exerciseId) return errors.push(`${at}: unknown exercise ${r.exercise ?? ''}`);
    const key = `${r.date}\n${r.workout}`;
    let workout = workouts.get(key);
    if (!workout) {
      workout = { id: createId(), exercises: new Map() };
      workouts.set(key, workout);
      const noon = `${r.date}T12:00:00.000Z`;
      out.workout.rows.push({ at, cells: [workout.id, r.workout, r.date, timeZone, noon, noon] });
    }
    let workoutExerciseId = workout.exercises.get(exerciseId);
    if (!workoutExerciseId) {
      workoutExerciseId = createId();
      out.workout_exercise.rows.push({ at, cells: [workoutExerciseId, workout.id, exerciseId, String(workout.exercises.size)] });
      workout.exercises.set(exerciseId, workoutExerciseId);
      for (const m of db.all('SELECT muscle, role FROM exercise_muscle WHERE exercise_id = ?', [exerciseId]))
        out.workout_exercise_muscle.rows.push({ at, cells: [workoutExerciseId, m.muscle as string, m.role as string] });
    }
    const position = out.workout_set.rows.filter((s) => s.cells[1] === workoutExerciseId).length;
    out.workout_set.rows.push({
      at,
      cells: [createId(), workoutExerciseId, String(position), r.type ?? 'normal', r.weight ?? '0', r.unit ?? 'kg', r.reps ?? '0', r.duration, r.distance, r.rounds, r.recovery, r.rest, r.rpe, r.comment, '1'],
    });
  });
  return Object.values(out);
};

export const readImport = (db: Db, chunks: Iterable<Uint8Array>, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, photo?: PhotoSink, openSqlite?: () => Db): Import => {
  const errors: string[] = [];
  const names = tables(db).map((t) => `${t}.csv`);
  const photos = new Set<string>();
  const iterator = chunks[Symbol.iterator]();
  const first = iterator.next().value ?? new Uint8Array(0);
  const stream = (function* () {
    yield first;
    for (let next = iterator.next(); !next.done; next = iterator.next()) yield next.value;
  })();
  try {
    if (strFromU8(first.subarray(0, 16)) === 'SQLite format 3\0') {
      const file = openSqlite?.();
      if (!file || !isFitNotes(file)) return { tables: [], errors: ['This SQLite file is not a FitNotes backup'] };
      return { ...fromFitNotes(db, file, timeZone, errors), app: 'fitnotes', errors };
    }
    if (first[0] !== 0x50 || first[1] !== 0x4b) {
      const parts: Uint8Array[] = [];
      let size = 0;
      for (const chunk of stream) {
        if ((size += chunk.length) > maxImportText) return { tables: [], errors: ['The file is larger than 64 MB'] };
        parts.push(chunk);
      }
      const text = strFromU8(concat(parts)).replace(/^\uFEFF/, '');
      const rows = parseCsv(text, /^[^,\n]*;/.test(text) ? ';' : ',');
      if (!rows.length) return { tables: [], errors: ['The file is empty'] };
      if (isStrong(rows[0])) return { ...fromStrong(db, rows, timeZone, errors), app: 'strong', errors };
      if (isHevy(rows[0])) return { ...fromHevy(db, rows, timeZone, errors), app: 'hevy', errors };
      if (isHevyMeasurements(rows[0])) return { ...fromHevyMeasurements(db, rows, errors), app: 'hevy', errors };
      if (isStrengthLog(rows[0])) return { ...fromStrengthLog(db, rows, timeZone, errors), app: 'strengthlog', errors };
      return { tables: fromTemplate(db, rows, timeZone, errors), errors };
    }
    const files = unpack(stream, errors, photos, photo);
    if (isStrongMeasurements(files)) return { ...fromStrongMeasurements(db, files, (text) => parseCsv(text, ';'), errors), app: 'strong', errors };
    const manifest = files['manifest.json'] ? JSON.parse(files['manifest.json']) : null;
    if (manifest?.format !== format.name || manifest.version !== format.version) return { tables: [], errors: ['Not a nicereps export: manifest.json is missing or has another format'] };
    if (!(Number.isInteger(manifest.schema) && manifest.schema >= 1 && manifest.schema <= migrations.length))
      return { tables: [], errors: [`The export's schema version ${manifest.schema} is not supported by this app (${migrations.length})`] };
    for (const name of Object.keys(files)) if (name !== 'manifest.json' && !names.includes(name)) errors.push(`Unexpected file in archive: ${name}`);
    const parsed = names
      .filter((name) => files[name] !== undefined)
      .map((name): Parsed => {
        const [columns, ...rows] = parseCsv(files[name]);
        const header = (columns ?? []).map((c) => c ?? '');
        const km = name.endsWith('_set.csv') && !header.includes('distance_unit');
        return {
          table: name.slice(0, -4),
          columns: km ? [...header, 'distance_unit'] : header,
          rows: rows
            .map((cells, i) => ({ at: `${name} row ${i + 2}`, cells: km ? [...cells, 'km'] : cells }))
            .filter(({ cells }) => name !== 'photo.csv' || photos.has(cells[header.indexOf('file')] ?? '')),
        };
      });
    return { tables: parsed, errors };
  } catch (error) {
    return { tables: [], errors: [...errors, (error as Error).message] };
  }
};

const typed = (db: Db, p: Parsed, errors: string[]) => {
  const info = new Map(db.all(`PRAGMA table_info(${p.table})`).map((c) => [c.name as string, c.type as string]));
  const unknown = p.columns.filter((c) => !info.has(c));
  if (unknown.length) return errors.push(`${p.table}.csv: unknown columns ${unknown.join(', ')}`), [];
  return p.rows.flatMap(({ at, cells }) => {
    if (p.table === 'setting' && deviceSettings.has(cells[p.columns.indexOf('key')] ?? '')) return [];
    if (cells.length !== p.columns.length) return errors.push(`${at}: expected ${p.columns.length} cells, found ${cells.length}`), [];
    const row: Row = {};
    const bad = p.columns.flatMap((c, i) => {
      const v = cells[i];
      row[c] = v;
      if (v === null) return [];
      if (info.get(c) === 'INTEGER' || info.get(c) === 'REAL') {
        const n = (row[c] = Number(v));
        if (!v.trim() || !Number.isFinite(n) || n < 0 || (info.get(c) === 'INTEGER' && !Number.isInteger(n))) return [`${c} must be a non-negative ${info.get(c) === 'INTEGER' ? 'whole ' : ''}number`];
        if (/rpe$/.test(c) && (n < 1 || n > 10)) return [`${c} must be between 1 and 10`];
      }
      if ((c === 'id' || c === 'superset' || c.endsWith('_id')) && !isCuid(v)) return [`${c} is not a valid ID`];
      if (c === 'fields' && v && !v.split(',').every((f) => (optionalFields as readonly string[]).includes(f))) return [`${c} must list only: ${optionalFields.join(', ')}`];
      if (c === 'date' && !isDate(v)) return [`${c} must be a YYYY-MM-DD date`];
      if (c.endsWith('_at') && !(/^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)))) return [`${c} must be an ISO timestamp`];
      return [];
    });
    const setting = p.table === 'setting' && badSetting(String(row.key), String(row.value));
    if (setting) bad.push(`${row.key} ${setting}`);
    if (bad.length) return errors.push(`${at}: ${bad.join('; ')}`), [];
    return [{ at, row }];
  });
};

const run = (db: Db, picked: Import, action: Action, overrides: Record<string, Action>, map: Record<string, string>, commit: boolean): Preview => {
  const { imp, exercises, unmatched, remember, errors: matching } = resolveExercises(db, picked, map);
  const errors = [...imp.errors, ...matching];
  const counts: Preview['counts'] = {};
  const duplicates: Duplicate[] = [];
  const maps: Record<string, Map<Value, Value>> = {};
  const keys = (table: string) => db.all(`PRAGMA table_info(${table})`).filter((c) => c.pk).map((c) => c.name as string);
  const known = (table: string) => new Set(db.all(`PRAGMA table_info(${table})`).map((c) => c.name as string));
  const skipped = new Set<string>();
  const owned = (table: string) =>
    imp.tables.flatMap((c) =>
      db
        .all(`PRAGMA foreign_key_list(${c.table})`)
        .filter((f) => f.table === table && keys(c.table).length > 1 && keys(c.table).includes(f.from as string) && c.columns.every((x) => known(c.table).has(x)))
        .map((f) => {
          const from = f.from as string;
          const at = c.columns.indexOf(from);
          const set = (values: (Value | undefined)[][]) => JSON.stringify(values.map((v) => JSON.stringify(v.map((x, j) => (j === at ? '' : String(x ?? ''))))).sort());
          const file = new Map<Value, (string | null)[][]>();
          for (const r of c.rows) file.set(r.cells[at], [...(file.get(r.cells[at]) ?? []), r.cells]);
          const matches = (fileId: Value, localId: Value) =>
            set(file.get(fileId) ?? []) === set(db.all(`SELECT ${c.columns.join(', ')} FROM ${c.table} WHERE ${from} = ?`, [localId]).map((r) => c.columns.map((x) => r[x])));
          return { table: c.table, from, matches };
        }),
    );
  db.run('BEGIN');
  try {
    for (const p of imp.tables) {
      const rows = typed(db, p, errors);
      const pk = keys(p.table);
      const children = owned(p.table);
      const fks = db.all(`PRAGMA foreign_key_list(${p.table})`).map((f) => ({ from: f.from as string, table: f.table as string }));
      const parents = fks.filter((f) => pk.length > 1 && pk.includes(f.from));
      const uniques = db
        .all(`PRAGMA index_list(${p.table})`)
        .filter((x) => x.unique)
        .sort((a, b) => Number(b.origin === 'pk') - Number(a.origin === 'pk'))
        .map((x) => db.all(`PRAGMA index_info(${x.name})`).map((c) => c.name as string));
      const map = (maps[p.table] = new Map());
      const inserted = new Set<string>();
      const count = (counts[p.table] = { new: 0, duplicates: 0, unchanged: 0 });
      rows.forEach(({ at, row }, i) => {
        for (const f of fks) if (maps[f.table]?.has(row[f.from])) row[f.from] = maps[f.table].get(row[f.from])!;
        if (parents.some((f) => skipped.has(`${f.table}:${row[f.from]}`))) return;
        const hits = new Map<string, Row>();
        for (const u of uniques.filter((u) => u.every((c) => row[c] != null))) {
          const hit = db.all(`SELECT ${pk.join(', ')} FROM ${p.table} WHERE ${u.map((c) => `${c} = ?`).join(' AND ')}`, u.map((c) => row[c]))[0];
          if (hit) hits.set(JSON.stringify(pk.map((c) => hit[c])), hit);
        }
        const [hitKey, hit] = [...hits][0] ?? [];
        try {
          if (hits.size > 1) throw new Error('matches more than one existing row');
          if (!hit) {
            const columns = p.columns.filter((c) => row[c] !== undefined);
            db.run(`INSERT INTO ${p.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map((c) => row[c]));
            inserted.add(JSON.stringify(pk.map((c) => row[c])));
            count.new++;
            return;
          }
          if (inserted.has(hitKey)) throw new Error('repeats an earlier row in this file');
          if (pk.length === 1) map.set(row[pk[0]], hit[pk[0]]);
          const key = `${p.table}:${i}`;
          const local = db.all(`SELECT * FROM ${p.table} WHERE ${pk.map((c) => `${c} = ?`).join(' AND ')}`, pk.map((c) => hit[c]))[0];
          const same = p.columns.every((c) => pk.includes(c) || local[c] === row[c]) && children.every((c) => c.matches(row[pk[0]], hit[pk[0]]));
          const label = p.columns.filter((c) => !pk.includes(c) && !c.endsWith('_id') && row[c] !== null).slice(0, 3).map((c) => row[c]).join(' · ');
          if (same) count.unchanged++;
          else {
            duplicates.push({ key, table: p.table, label: label || String(hit[pk[0]]) });
            count.duplicates++;
          }
          const chosen = overrides[key] ?? action;
          if (chosen === 'skip' && !same && children.length) skipped.add(`${p.table}:${hit[pk[0]]}`);
          if (chosen === 'replace') for (const c of children) db.run(`DELETE FROM ${c.table} WHERE ${c.from} = ?`, [hit[pk[0]]]);
          const set = chosen === 'skip' ? [] : p.columns.filter((c) => !pk.includes(c) && (chosen === 'replace' || row[c] !== null));
          if (set.length) db.run(`UPDATE ${p.table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE ${pk.map((c) => `${c} = ?`).join(' AND ')}`, [...set.map((c) => row[c]), ...pk.map((c) => hit[c])]);
        } catch (error) {
          errors.push(`${at}: ${(error as Error).message}`);
        }
      });
    }
    for (const m of db.all("SELECT m.id FROM measurement m JOIN measurement_series s ON s.id = m.series_id WHERE (s.kind = 'weight') <> (m.unit IN ('kg', 'lb'))"))
      errors.push(`measurement ${m.id}: unit does not match its series`);
    if (commit && !errors.length && !unmatched.length) {
      remember?.();
      db.run('COMMIT');
    } else db.run('ROLLBACK');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
  return { counts, duplicates, errors, exercises, unmatched };
};

const newest = (imp: Import, table: string, columns: string[]) => {
  const t = imp.tables.find((x) => x.table === table);
  const at = columns.map((c) => t?.columns.indexOf(c) ?? -1);
  if (!t || at.includes(-1)) return null;
  return t.rows.map((r) => at.map((i) => r.cells[i] ?? '')).reduce<string[] | null>((a, b) => (!a || b.join('\n') > a.join('\n') ? b : a), null);
};

export const importHighlights = (imp: Import) => {
  const workout = newest(imp, 'workout', ['date', 'started_at', 'name']);
  return { workout: workout && { date: workout[0], name: workout[2] }, measured: newest(imp, 'measurement', ['date'])?.[0] ?? null };
};

export const previewImport = (db: Db, imp: Import, action: Action = 'skip', overrides: Record<string, Action> = {}, map: Record<string, string> = {}) =>
  run(db, imp, action, overrides, map, false);

export const applyImport = (db: Db, imp: Import, action: Action, overrides: Record<string, Action> = {}, map: Record<string, string> = {}) => {
  const result = run(db, imp, action, overrides, map, true);
  if (result.errors.length) throw new Error(`Import rejected, nothing was written: ${result.errors[0]}`);
  if (result.unmatched.length) throw new Error(`Import rejected, nothing was written: match ${result.unmatched[0]} to an exercise first`);
  return result;
};
