import assert from 'node:assert/strict';
import test from 'node:test';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { openDb } from '../cli/db.ts';
import { seed } from '../cli/fixtures.ts';
import { catalog } from '../assets/catalog/exercises.ts';
import { addPhoto, logMeasurements, starSeries } from '../src/domain/measurements.ts';
import { applyImport, blankTemplate, eraseAll, exportArchive, importHighlights, parseCsv, previewImport, readImport, toCsv } from '../src/domain/portability.ts';
import { changeDay, correctSet, createExercise, firstRun, listTemplates, scheduleWeekday, rateWorkout, setExerciseNote, setSetting, starRecord } from '../src/domain/workouts.ts';

const filled = () => {
  const db = openDb(':memory:');
  seed(db);
  createExercise(db, 'Tyre Flip Custom', [{ muscle: 'quads', role: 'primary' }], { equipment: 'tyre' });
  const template = listTemplates(db)[0].id;
  scheduleWeekday(db, 'monday', template);
  changeDay(db, '2026-10-12', null);
  setSetting(db, 'weightUnit', 'lb');
  const [series] = logMeasurements(db, [{ series: { preset: 'body-weight' }, value: 81.35 }, { series: { preset: 'waist' }, value: 84 }], '2026-10-01');
  starSeries(db, series.seriesId, true);
  starRecord(db, db.all("SELECT id FROM exercise WHERE name = 'Romanian Deadlift'")[0].id as string, 'e1rm', true);
  addPhoto(db, '2026-10-01', 'a.jpg');
  addPhoto(db, '2026-10-01', 'b.jpg');
  addPhoto(db, '2026-10-02', 'gone.jpg');
  db.run("INSERT INTO photo (id, date, file) VALUES ('p-bad', '2026-10-02', '../escape.jpg')");
  correctSet(db, db.all('SELECT id FROM workout_set LIMIT 1')[0].id as string, { comment: 'grip "wide",\nslow down' });
  return db;
};

const exported = async (db: ReturnType<typeof openDb>, photos: Record<string, Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  const result = await exportArchive(db, (file) => photos[file] ?? null, (chunk) => chunks.push(chunk), new Date('2026-10-11T00:00:00Z'));
  return { result, files: unzipSync(Buffer.concat(chunks)) };
};

test('CSV cells round trip commas, quotes, newlines, empty strings and nulls', () => {
  const rows = [{ a: 'plain', b: 1.25, c: null }, { a: 'say "hi", ok\r\nnext', b: 0, c: '' }];
  assert.deepEqual(parseCsv(toCsv(['a', 'b', 'c'], rows)), [['a', 'b', 'c'], ['plain', '1.25', null], ['say "hi", ok\r\nnext', '0', '']]);
  assert.throws(() => parseCsv('a,"b"c\r\n'), /Malformed CSV at character 2/);
});

test('text cells that a spreadsheet would run as formulas are escaped on export and restored on import', () => {
  const rows = [{ a: '=SUM(A1)' }, { a: "'=x" }, { a: '-ish' }, { a: '@me' }, { a: "'plain" }, { a: -5 }];
  const csv = toCsv(['a'], rows);
  assert.equal(csv, "a\r\n'=SUM(A1)\r\n''=x\r\n'-ish\r\n'@me\r\n'plain\r\n-5\r\n");
  assert.deepEqual(parseCsv(csv).slice(1).flat(), ['=SUM(A1)', "'=x", '-ish', '@me', "'plain", '-5']);
});

test('the export archive holds every row of every table, a manifest and every photo file', async () => {
  const db = filled();
  db.run("INSERT INTO app_exercise (app, name, exercise_id) SELECT 'strong', 'Bench Press (Barbell)', id FROM exercise LIMIT 1");
  const photos = { 'a.jpg': new Uint8Array([1, 2, 3]), 'b.jpg': new Uint8Array([4, 5]), '../escape.jpg': new Uint8Array([6]) };
  const { result, files } = await exported(db, photos);
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('app_exercise', 'health_record')").map((t) => t.name as string);
  assert.equal(tables.length, 16);
  assert.equal(files['app_exercise.csv'], undefined);
  for (const table of tables) {
    const columns = db.all(`PRAGMA table_info(${table})`).map((c) => c.name as string);
    const rows = db.all(`SELECT * FROM ${table} ORDER BY rowid`);
    assert.ok(rows.length > 0, table);
    assert.deepEqual(parseCsv(strFromU8(files[`${table}.csv`])), [columns, ...rows.map((r) => columns.map((c) => (r[c] === null ? null : String(r[c]))))], table);
  }
  assert.deepEqual(files['photos/a.jpg'], photos['a.jpg']);
  assert.deepEqual(files['photos/b.jpg'], photos['b.jpg']);
  assert.deepEqual(result.missing, ['gone.jpg', '../escape.jpg']);
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.deepEqual(
    { ...manifest, tables: undefined },
    { format: 'nicereps', version: 1, schema: 20, exportedAt: '2026-10-11T00:00:00.000Z', tables: undefined, photos: ['a.jpg', 'b.jpg'] },
  );
  assert.equal(manifest.tables.photo, 4);
  assert.equal(Object.keys(files).length, tables.length + 3);
});

test('erasing deletes every record, returns the photo files to delete and restores the catalog', () => {
  const db = filled();
  assert.equal(firstRun(db), false);
  assert.deepEqual(eraseAll(db).sort(), ['a.jpg', 'b.jpg', 'gone.jpg']);
  assert.equal(firstRun(db), true);
  const counts = Object.fromEntries(
    db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => [t.name, db.all(`SELECT count(*) AS n FROM ${t.name}`)[0].n]),
  );
  const fresh = openDb(':memory:');
  assert.equal(counts.exercise, Object.keys(catalog).length);
  assert.equal(counts.exercise_muscle, fresh.all('SELECT count(*) AS n FROM exercise_muscle')[0].n);
  assert.deepEqual(
    Object.entries(counts).filter(([t, n]) => n && !t.startsWith('exercise')),
    [],
  );
  assert.equal(db.all("SELECT count(*) AS n FROM exercise WHERE name = 'Tyre Flip Custom'")[0].n, 0);
});

const tableNames = (db: ReturnType<typeof openDb>) =>
  db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name as string);

const records = (db: ReturnType<typeof openDb>) => {
  const exercise = new Map(db.all('SELECT id, source, name FROM exercise').map((e) => [e.id, `${e.source ?? e.name}`]));
  return Object.fromEntries(
    tableNames(db).map((t) => [
      t,
      db
        .all(`SELECT * FROM ${t}`)
        .map((r) => JSON.stringify(Object.entries(r).map(([c, v]) => [c, (t === 'exercise' && c === 'id') || c === 'exercise_id' ? exercise.get(v) : v])))
        .sort(),
    ]),
  );
};

const archive = async (db: ReturnType<typeof openDb>) => {
  const chunks: Uint8Array[] = [];
  await exportArchive(db, () => new Uint8Array([9]), (chunk) => chunks.push(chunk));
  return chunks;
};

const clean = () => {
  const db = filled();
  db.run("DELETE FROM photo WHERE id = 'p-bad'");
  return db;
};

const rezip = (chunks: Uint8Array[], change: (files: Record<string, Uint8Array>) => void) => {
  const files = unzipSync(Buffer.concat(chunks));
  change(files);
  return [zipSync(files)];
};

const sink = () => {
  const saved: Record<string, Uint8Array[]> = {};
  const photo = (file: string) => ((saved[file] = []), (data: Uint8Array) => void saved[file].push(data));
  return { saved, photo };
};

test('an export imported into a fresh install restores every record and photo file', async () => {
  const source = clean();
  const fresh = openDb(':memory:');
  const { saved, photo } = sink();
  const imp = readImport(fresh, await archive(source), undefined, photo);
  assert.deepEqual(imp.errors, []);
  assert.deepEqual(Object.keys(saved).sort(), ['a.jpg', 'b.jpg', 'gone.jpg']);
  assert.deepEqual(Buffer.concat(saved['a.jpg']), Buffer.from([9]));
  const preview = previewImport(fresh, imp);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.counts.workout.new, source.all('SELECT count(*) AS n FROM workout')[0].n);
  assert.equal(preview.counts.exercise.duplicates + preview.counts.exercise.unchanged, Object.keys(catalog).length);
  assert.equal(preview.counts.exercise.new, source.all('SELECT count(*) AS n FROM exercise WHERE source IS NULL')[0].n);
  assert.deepEqual(preview.duplicates.filter((d) => d.table === 'exercise').map((d) => d.label.split(' · ')[0]), ['Romanian Deadlift']);
  assert.equal(preview.counts.photo.new, 3);
  const [workout] = source.all('SELECT name, date FROM workout ORDER BY date DESC, started_at DESC LIMIT 1');
  assert.deepEqual(importHighlights(imp), { workout: { name: workout.name, date: workout.date }, measured: source.all('SELECT max(date) AS d FROM measurement')[0].d });
  assert.equal(fresh.all('SELECT count(*) AS n FROM workout')[0].n, 0);
  const skipped = openDb(':memory:');
  applyImport(skipped, readImport(skipped, await archive(source)), 'skip');
  assert.equal(records(source).starred_record.length, 1);
  assert.deepEqual(records(skipped).starred_record, records(source).starred_record);
  applyImport(fresh, imp, 'replace');
  assert.deepEqual(records(fresh), records(source));
});

test('photo rows import only with a file from the archive; other paths are rejected', async () => {
  const source = filled();
  const chunks: Uint8Array[] = [];
  await exportArchive(source, (file) => (file === 'gone.jpg' ? null : new Uint8Array([9])), (chunk) => chunks.push(chunk));
  const files = (db: ReturnType<typeof openDb>) => db.all('SELECT file FROM photo ORDER BY file').map((p) => p.file);
  const withSink = openDb(':memory:');
  applyImport(withSink, readImport(withSink, chunks, undefined, sink().photo), 'replace');
  assert.deepEqual(files(withSink), ['a.jpg', 'b.jpg']);
  const without = openDb(':memory:');
  applyImport(without, readImport(without, chunks), 'replace');
  assert.deepEqual(files(without), []);
  const { saved, photo } = sink();
  const traversal = readImport(openDb(':memory:'), rezip(chunks, (f) => void (f['photos/../x.jpg'] = new Uint8Array([1]))), undefined, photo);
  assert.deepEqual(traversal.errors, ['Unexpected file in archive: photos/../x.jpg']);
  assert.deepEqual(Object.keys(saved).sort(), ['a.jpg', 'b.jpg']);
});

test('re-importing into the same install finds every row a duplicate; skip, update and replace apply per row', async () => {
  const db = clean();
  const chunks = await archive(db);
  const [a, b, c] = db.all('SELECT id FROM workout ORDER BY rowid LIMIT 3').map((w) => w.id as string);
  db.run("UPDATE workout SET name = 'Local', note = 'mine' WHERE id IN (?, ?, ?)", [a, b, c]);
  const before = records(db);
  const imp = readImport(db, chunks);
  const preview = previewImport(db, imp);
  assert.equal(preview.duplicates.length, Object.values(preview.counts).reduce((n, t) => n + t.duplicates, 0));
  assert.ok(Object.values(preview.counts).every((t) => t.new === 0));
  assert.deepEqual(preview.duplicates.map((d) => d.table), ['workout', 'workout', 'workout']);
  applyImport(db, imp, 'skip');
  assert.deepEqual(records(db), before);
  const key = (id: string) => preview.duplicates.find((d) => d.table === 'workout' && d.key === `workout:${db.all('SELECT rowid - 1 AS i FROM workout WHERE id = ?', [id])[0].i}`)!.key;
  applyImport(db, imp, 'skip', { [key(a)]: 'update', [key(b)]: 'replace' });
  const rows = Object.fromEntries(db.all('SELECT id, name, note FROM workout WHERE id IN (?, ?, ?)', [a, b, c]).map((w) => [w.id, [w.name, w.note]]));
  assert.notEqual(rows[a][0], 'Local');
  assert.equal(rows[a][1], 'mine');
  assert.deepEqual([rows[b][0] === 'Local', rows[b][1]], [false, null]);
  assert.deepEqual(rows[c], ['Local', 'mine']);
});

test('an older export without distance units replaces local mile distances as km', async () => {
  const db = clean();
  const id = db.all('SELECT id FROM workout_set LIMIT 1')[0].id as string;
  db.run("UPDATE workout_set SET distance = 5 WHERE id = ?", [id]);
  const chunks = rezip(await archive(db), (f) => {
    const [header, ...rows] = parseCsv(strFromU8(f['workout_set.csv'])) as string[][];
    const at = header.indexOf('distance_unit');
    f['workout_set.csv'] = strToU8(toCsv(header.filter((_, i) => i !== at), rows.map((r) => Object.fromEntries(header.map((c, i) => [c, r[i]])))));
  });
  db.run("UPDATE workout_set SET distance_unit = 'mi' WHERE id = ?", [id]);
  const imp = readImport(db, chunks);
  assert.ok(previewImport(db, imp).duplicates.some((d) => d.table === 'workout_set'));
  applyImport(db, imp, 'replace');
  assert.deepEqual({ ...db.all('SELECT distance, distance_unit FROM workout_set WHERE id = ?', [id])[0] }, { distance: 5, distance_unit: 'km' });
});

test('skipping a changed exercise keeps its local muscle mapping; replace restores the imported one', async () => {
  const db = clean();
  const chunks = await archive(db);
  const original = records(db);
  const [m] = db.all('SELECT exercise_id, muscle FROM exercise_muscle WHERE exercise_id IN (SELECT exercise_id FROM exercise_muscle GROUP BY exercise_id HAVING count(*) > 1) LIMIT 1');
  db.run('DELETE FROM exercise_muscle WHERE exercise_id = ? AND muscle = ?', [m.exercise_id, m.muscle]);
  const before = records(db);
  const imp = readImport(db, chunks);
  assert.deepEqual(previewImport(db, imp).duplicates.map((d) => d.table), ['exercise']);
  applyImport(db, imp, 'skip');
  assert.deepEqual(records(db), before);
  applyImport(db, imp, 'replace');
  assert.deepEqual(records(db), original);
});

test('a typed 0 travels in workout_set.csv; an older export without reps_entered treats an incomplete 0 as blank', async () => {
  const db = clean();
  const [typed, blank, done] = db.all('SELECT id FROM workout_set ORDER BY rowid LIMIT 3').map((r) => r.id as string);
  db.run('UPDATE workout_set SET reps = 0, completed = 0, reps_entered = 1 WHERE id = ?', [typed]);
  db.run('UPDATE workout_set SET reps = 0, completed = 0, reps_entered = 0 WHERE id = ?', [blank]);
  db.run('UPDATE workout_set SET reps = 0, completed = 1, reps_entered = 1 WHERE id = ?', [done]);
  const flags = (d: ReturnType<typeof openDb>) => [typed, blank, done].map((id) => d.all('SELECT reps_entered FROM workout_set WHERE id = ?', [id])[0].reps_entered);
  const chunks = await archive(db);
  const copy = openDb(':memory:');
  applyImport(copy, readImport(copy, chunks), 'replace');
  assert.deepEqual(flags(copy), [1, 0, 1]);
  const older = rezip(chunks, (f) => {
    const [header, ...rows] = parseCsv(strFromU8(f['workout_set.csv'])) as string[][];
    f['workout_set.csv'] = strToU8(toCsv(header.filter((c) => c !== 'reps_entered'), rows.map((r) => Object.fromEntries(header.map((c, i) => [c, r[i]])))));
  });
  const old = openDb(':memory:');
  applyImport(old, readImport(old, older), 'replace');
  assert.deepEqual(flags(old), [0, 0, 1]);
});

test("exercise notes travel in exercise.csv; an older export without the column keeps local notes", async () => {
  const db = clean();
  const note = (d: ReturnType<typeof openDb>, name: string) => d.all('SELECT note FROM exercise WHERE name = ?', [name])[0].note;
  const id = (name: string) => db.all('SELECT id FROM exercise WHERE name = ?', [name])[0].id as string;
  setExerciseNote(db, id('Back Squat'), 'seat 4, "pin" 7');
  setExerciseNote(db, id('Tyre Flip Custom'), '=big tyre');
  const catalog = db.all('SELECT name FROM exercise WHERE source IS NOT NULL LIMIT 1')[0].name as string;
  setExerciseNote(db, id(catalog), 'cable at 3');
  const chunks = await archive(db);
  const [header] = parseCsv(strFromU8(unzipSync(Buffer.concat(chunks))['exercise.csv']));
  assert.ok(header.includes('note'));
  const fresh = openDb(':memory:');
  applyImport(fresh, readImport(fresh, chunks), 'update');
  assert.notEqual(fresh.all('SELECT id FROM exercise WHERE name = ?', [catalog])[0].id, id(catalog));
  assert.deepEqual([note(fresh, 'Back Squat'), note(fresh, 'Tyre Flip Custom'), note(fresh, catalog)], ['seat 4, "pin" 7', '=big tyre', 'cable at 3']);
  const old = rezip(chunks, (f) => {
    const [columns, ...rows] = parseCsv(strFromU8(f['exercise.csv'])) as string[][];
    f['exercise.csv'] = strToU8(toCsv(columns.filter((c) => c !== 'note'), rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))));
  });
  setExerciseNote(db, id('Back Squat'), 'narrow grip');
  for (const action of ['update', 'replace'] as const) {
    applyImport(db, readImport(db, old), action);
    assert.equal(note(db, 'Back Squat'), 'narrow grip');
  }
  const blank = openDb(':memory:');
  applyImport(blank, readImport(blank, old), 'replace');
  assert.equal(note(blank, 'Back Squat'), null);
  assert.equal(note(blank, 'Tyre Flip Custom'), null);
});

test('check-ins travel in workout.csv; an older export without them keeps local check-ins; out-of-range values are rejected', async () => {
  const db = clean();
  const [first, second] = db.all('SELECT id FROM workout ORDER BY rowid').map((w) => w.id as string);
  const rated = (d: ReturnType<typeof openDb>, id: string) => d.all('SELECT sleep, feel, energy FROM workout WHERE id = ?', [id])[0];
  rateWorkout(db, first, 'sleep', 4);
  rateWorkout(db, first, 'feel', 2);
  rateWorkout(db, first, 'energy', 5);
  const chunks = await archive(db);
  const fresh = openDb(':memory:');
  applyImport(fresh, readImport(fresh, chunks), 'update');
  assert.deepEqual({ ...rated(fresh, first) }, { sleep: 4, feel: 2, energy: 5 });
  assert.deepEqual({ ...rated(fresh, second) }, { sleep: null, feel: null, energy: null });
  const old = rezip(chunks, (f) => {
    const [columns, ...rows] = parseCsv(strFromU8(f['workout.csv'])) as string[][];
    f['workout.csv'] = strToU8(toCsv(columns.filter((c) => !['sleep', 'feel', 'energy'].includes(c)), rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])))));
  });
  rateWorkout(db, first, 'sleep', 1);
  applyImport(db, readImport(db, old), 'replace');
  assert.deepEqual({ ...rated(db, first) }, { sleep: 1, feel: 2, energy: 5 });
  const target = openDb(':memory:');
  const before = records(target);
  for (const [bad, error] of [['6', /sleep must be between 1 and 5/], ['0', /sleep must be between 1 and 5/], ['2.5', /whole number/], ['-1', /non-negative/]] as const) {
    const file = rezip(chunks, (f) => (f['workout.csv'] = strToU8(strFromU8(f['workout.csv']).replace(',4,2,5', `,${bad},2,5`))));
    assert.match(previewImport(target, readImport(target, file)).errors.join('\n'), error);
    assert.throws(() => applyImport(target, readImport(target, file), 'replace'));
    assert.deepEqual(records(target), before);
  }
  assert.throws(() => rateWorkout(db, first, 'feel', 0), /Session felt must be 1 to 5/);
});

test('malformed imports are rejected with no partial writes', async () => {
  const db = clean();
  const chunks = await archive(db);
  const target = openDb(':memory:');
  const before = records(target);
  const cases: [string, Uint8Array[], RegExp][] = [
    ['bad id', rezip(chunks, (f) => (f['workout_set.csv'] = strToU8(strFromU8(f['workout_set.csv']).replace(/\r\n[a-z0-9]+,/, '\r\nnot an id!,')))), /id is not a valid ID/],
    ['missing parent', rezip(chunks, (f) => (f['workout.csv'] = strToU8(strFromU8(f['workout.csv']).split('\r\n')[0] + '\r\n'))), /FOREIGN KEY/],
    ['bad fields', rezip(chunks, (f) => (f['workout_set.csv'] = strToU8(strFromU8(f['workout_set.csv']).replace(/,,([01])\r\n/, ',weight,$1\r\n')))), /fields must list only/],
    ['bad number', rezip(chunks, (f) => (f['measurement.csv'] = strToU8(strFromU8(f['measurement.csv']).replace('81.35', 'heavy')))), /value must be a non-negative number/],
    ['bad unit', rezip(chunks, (f) => (f['measurement.csv'] = strToU8(strFromU8(f['measurement.csv']).replace(/,(kg|lb)\r\n/, ',cm\r\n')))), /unit does not match/],
    ['bad date', rezip(chunks, (f) => (f['measurement.csv'] = strToU8(strFromU8(f['measurement.csv']).replace('2026-10-01', '2026-13-01')))), /date must be/],
    ['unknown column', rezip(chunks, (f) => (f['setting.csv'] = strToU8('key,value,extra\r\nweightUnit,lb,1\r\n'))), /unknown columns extra/],
    ['path', rezip(chunks, (f) => (f['../evil.csv'] = strToU8('x'))), /Unexpected file in archive: \.\.\/evil\.csv/],
    ['schema', rezip(chunks, (f) => (f['manifest.json'] = strToU8(strFromU8(f['manifest.json']).replace('"schema": 20', '"schema": 99')))), /schema version 99/],
    ['no manifest', rezip(chunks, (f) => delete f['manifest.json']), /Not a nicereps export/],
    ['broken csv', rezip(chunks, (f) => (f['template.csv'] = strToU8('id,name\r\n"a"b\r\n'))), /Malformed CSV/],
    ['too large', rezip(chunks, (f) => (f['template.csv'] = new Uint8Array(65 * 1024 * 1024).fill(65))), /more than 64 MB/],
    ['not a zip', [new Uint8Array([0x50, 0x4b, 1, 2, 3])], /./],
    ['bad setting', rezip(chunks, (f) => (f['setting.csv'] = strToU8('key,value\r\nweightUnit,stone\r\n'))), /weightUnit must be one of: kg, lb/],
    ['sql in a header', rezip(chunks, (f) => (f['exercise_muscle.csv'] = strToU8(strFromU8(f['exercise_muscle.csv']).replace('role', '"role FROM exercise_muscle; --"')))), /^(?![\s\S]*(range|syntax))[\s\S]*unknown columns/],
  ];
  for (const [name, input, error] of cases) {
    const imp = readImport(target, input);
    assert.match(previewImport(target, imp).errors.join('\n'), error, name);
    assert.throws(() => applyImport(target, imp, 'replace'), /nothing was written/, name);
    assert.deepEqual(records(target), before, name);
  }
});

test('backup and health settings stay on the device: export leaves them out and import skips them', async () => {
  const db = clean();
  for (const key of ['backupFolder', 'backupAt', 'backupError', 'backupDismissedAt', 'exportedAt', 'health', 'healthAt', 'healthError']) db.run('INSERT INTO setting (key, value) VALUES (?, ?)', [key, 'x']);
  const chunks = await archive(db);
  assert.doesNotMatch(strFromU8(unzipSync(Buffer.concat(chunks))['setting.csv']), /backup|exportedAt|health/);
  const target = openDb(':memory:');
  target.run("INSERT INTO setting (key, value) VALUES ('backupFolder', 'mine')");
  const imp = readImport(target, rezip(chunks, (f) => (f['setting.csv'] = strToU8('key,value\r\nweightUnit,lb\r\nbackupFolder,theirs\r\nbackupAt,x\r\nhealth,on\r\n'))));
  assert.deepEqual(previewImport(target, imp).errors, []);
  applyImport(target, imp, 'replace');
  assert.deepEqual(target.all("SELECT key, value FROM setting WHERE key LIKE 'backup%' OR key LIKE 'health%' OR key = 'weightUnit' ORDER BY key").map((r) => ({ ...r })), [{ key: 'backupFolder', value: 'mine' }, { key: 'weightUnit', value: 'lb' }]);
});

test('the blank CSV template imports as new finished workouts with the exercise mapping', () => {
  const db = openDb(':memory:');
  const imp = readImport(db, [strToU8(blankTemplate)], 'UTC');
  assert.deepEqual(importHighlights(imp), { workout: { name: 'Push', date: '2026-01-05' }, measured: null });
  assert.deepEqual(previewImport(db, imp).counts, { workout: { new: 1, duplicates: 0, unchanged: 0 }, workout_exercise: { new: 1, duplicates: 0, unchanged: 0 }, workout_exercise_muscle: { new: imp.tables[2].rows.length, duplicates: 0, unchanged: 0 }, workout_set: { new: 2, duplicates: 0, unchanged: 0 } });
  assert.equal(firstRun(db), true);
  applyImport(db, imp, 'skip');
  assert.equal(firstRun(db), false);
  const [w] = db.all('SELECT * FROM workout');
  assert.deepEqual([w.name, w.date, w.started_at, w.finished_at], ['Push', '2026-01-05', '2026-01-05T12:00:00.000Z', '2026-01-05T12:00:00.000Z']);
  assert.deepEqual(
    db.all('SELECT type, weight, unit, reps, rest, rpe, comment, completed FROM workout_set ORDER BY position').map((r) => ({ ...r })),
    [
      { type: 'warm-up', weight: 40, unit: 'kg', reps: 10, rest: 90, rpe: null, comment: null, completed: 1 },
      { type: 'normal', weight: 80, unit: 'kg', reps: 5, rest: 180, rpe: 8, comment: 'paused', completed: 1 },
    ],
  );
  assert.ok(db.all('SELECT count(*) AS n FROM workout_exercise_muscle')[0].n as number > 0);
  const bad = readImport(db, [strToU8('date,workout,exercise,weight\r\n2026-01-05,Pull,Nope,10\r\n2999-01-01,Pull,Barbell Bench Press - Medium Grip,10\r\n2026-01-05,Pull,barbell bench press - medium grip,heavy\r\n')], 'UTC');
  assert.match(previewImport(db, bad).errors.join('\n'), /line 2: unknown exercise Nope\n.*line 3: date must be a past.*\n.*line 4: weight must be/);
  assert.deepEqual(readImport(db, [strToU8('date,sets\r\n')]).errors, ['Unknown template columns: sets']);
});
