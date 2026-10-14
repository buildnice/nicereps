import assert from 'node:assert/strict';
import test from 'node:test';

import { openDb } from '../cli/db.ts';
import { addMeasurement, addPhoto, createSeries, deleteMeasurement, deletePhoto, deleteSeries, editMeasurement, listPhotos, listSeries, logMeasurements, presets, progress, starSeries } from '../src/domain/measurements.ts';

test('left and right series stay separate', () => {
  const db = openDb(':memory:');
  const left = addMeasurement(db, { preset: 'left-upper-arm' }, 34.5, '2026-10-01').seriesId;
  addMeasurement(db, { preset: 'right-upper-arm' }, 35.25, '2026-10-01');
  assert.equal(addMeasurement(db, { preset: 'left-upper-arm' }, 34.75, '2026-10-08').seriesId, left);
  db.run("UPDATE measurement_series SET name = 'Right upper arm' WHERE preset = 'right-upper-arm'");

  assert.deepEqual(
    listSeries(db).map((s) => [s.name, s.entries.map((e) => `${e.date} ${e.value} ${e.unit}`)]),
    [
      ['Left bicep', ['2026-10-01 34.5 cm', '2026-10-08 34.75 cm']],
      ['Right bicep', ['2026-10-01 35.25 cm']],
    ],
  );
});

test('every series shows its measurement method', () => {
  const db = openDb(':memory:');
  assert.equal(presets.length, 13);
  assert.ok(presets.every((p) => p.guide.length >= 3));
  addMeasurement(db, { preset: 'body-weight' }, 78.4, '2026-10-01');
  createSeries(db, '  Flexed arm ', 'length', ' Left arm flexed, tape at the peak ');
  createSeries(db, 'Wrist', 'length');

  assert.deepEqual(
    listSeries(db).map((s) => [s.name, s.kind, s.method[0]]),
    [
      ['Body weight', 'weight', 'Weigh after waking, before eating.'],
      ['Flexed arm', 'length', 'Left arm flexed, tape at the peak'],
      ['Wrist', 'length', undefined],
    ],
  );
});

test('invalid series and entries are rejected', () => {
  const db = openDb(':memory:');
  assert.throws(() => addMeasurement(db, { preset: 'waist' }, 0, '2026-10-01'), /positive/);
  assert.deepEqual(listSeries(db), []);
  const waist = { id: addMeasurement(db, { preset: 'waist' }, 80, '2026-10-01').seriesId };
  assert.throws(() => addMeasurement(db, { preset: 'ankle' }, 20, '2026-10-01'), /Unknown measurement preset/);
  assert.throws(() => createSeries(db, 'waist', 'length'), /already exists/);
  assert.throws(() => createSeries(db, 'Hips', 'length'), /already exists/);
  assert.throws(() => createSeries(db, ' ', 'length'), /required/);
  assert.throws(() => createSeries(db, 'Grip', 'force' as 'weight'), /weight or length/);
  assert.throws(() => addMeasurement(db, waist, 0, '2026-10-01'), /positive/);
  assert.throws(() => addMeasurement(db, waist, NaN, '2026-10-01'), /positive/);
  assert.throws(() => addMeasurement(db, waist, 80, '2026-02-30'), /Invalid date/);
  assert.throws(() => addMeasurement(db, { id: 'nope' }, 80, '2026-10-01'), /Not found/);
  assert.throws(() => createSeries(db, 'left-calf', 'length'), /already exists/);
  assert.throws(() => createSeries(db, 'Grip', 'toString' as 'weight'), /weight or length/);
  assert.throws(() => addMeasurement(db, { custom: { name: 'Wrist', kind: 'length' } }, 17, '2026-02-30'), /Invalid date/);
  assert.equal(listSeries(db).length, 1);
  assert.deepEqual(listSeries(db)[0].entries.map((e) => e.value), [80]);
});

test('edits and deletions change the series, and a deleted preset can start again', () => {
  const db = openDb(':memory:');
  const first = addMeasurement(db, { preset: 'waist' }, 82, '2026-10-01');
  const second = addMeasurement(db, { preset: 'waist' }, 81, '2026-10-08');
  addMeasurement(db, { preset: 'hips' }, 98, '2026-10-01');
  const entries = () => listSeries(db).map((s) => [s.name, s.entries.map((e) => `${e.date} ${e.value} ${e.unit}`)]);

  editMeasurement(db, first.id, 81.5, '2026-10-09');
  assert.deepEqual(entries()[0], ['Waist', ['2026-10-08 81 cm', '2026-10-09 81.5 cm']]);
  assert.throws(() => editMeasurement(db, first.id, 0, '2026-10-09'), /positive/);
  assert.throws(() => editMeasurement(db, first.id, 80, '2026-13-01'), /Invalid date/);
  assert.throws(() => editMeasurement(db, 'nope', 80, '2026-10-01'), /Not found/);

  deleteMeasurement(db, second.id);
  assert.deepEqual(entries()[0], ['Waist', ['2026-10-09 81.5 cm']]);
  assert.throws(() => deleteMeasurement(db, second.id), /Not found/);

  deleteSeries(db, first.seriesId);
  assert.deepEqual(entries(), [['Hips', ['2026-10-01 98 cm']]]);
  assert.equal(db.all('SELECT count(*) AS n FROM measurement')[0].n, 1);
  assert.throws(() => deleteSeries(db, first.seriesId), /Not found/);
  assert.notEqual(addMeasurement(db, { preset: 'waist' }, 80, '2026-10-10').seriesId, first.seriesId);
});

test('a stored preset key this version does not know still lists', () => {
  const db = openDb(':memory:');
  db.run("INSERT INTO measurement_series (id, name, preset, kind, method) VALUES ('s1', 'Ankle', 'ankle', 'length', NULL)");
  addMeasurement(db, { preset: 'neck' }, 38, '2026-10-01');
  assert.deepEqual(listSeries(db).map((s) => [s.name, s.method]), [['Neck', presets[1].guide], ['Ankle', []]]);
});

test('a full-body log saves every part on one date, or none', () => {
  const db = openDb(':memory:');
  const waist = { id: addMeasurement(db, { preset: 'waist' }, 82, '2026-10-01').seriesId };
  const entries = () => listSeries(db).map((s) => [s.name, s.entries.map((e) => `${e.date} ${e.value}`)]);
  const before = entries();

  assert.throws(() => logMeasurements(db, [{ series: waist, value: 81 }, { series: { custom: { name: 'Hips', kind: 'length' } }, value: 98 }], '2026-10-08'), /already exists/);
  assert.deepEqual(entries(), before);

  logMeasurements(db, [{ series: waist, value: 81 }, { series: { preset: 'neck' }, value: 38 }, { series: { custom: { name: 'Wrist', kind: 'length' } }, value: 17 }], '2026-10-08');
  assert.deepEqual(entries(), [
    ['Neck', ['2026-10-08 38']],
    ['Waist', ['2026-10-01 82', '2026-10-08 81']],
    ['Wrist', ['2026-10-08 17']],
  ]);
});

test('photos attach to a date and outlive measurement deletes', () => {
  const db = openDb(':memory:');
  const { id, seriesId } = addMeasurement(db, { preset: 'waist' }, 80, '2026-10-01');
  const photo = addPhoto(db, '2026-10-01', 'abc.jpg');
  assert.throws(() => addPhoto(db, '2026-10-01', '../abc.jpg'), /Invalid photo file/);
  assert.throws(() => addPhoto(db, '2026-13-01', 'def.jpg'), /Invalid date/);
  assert.throws(() => addPhoto(db, '2026-10-02', 'abc.jpg'), /UNIQUE/);
  deleteMeasurement(db, id);
  deleteSeries(db, seriesId);
  assert.deepEqual(listPhotos(db), [{ id: photo, date: '2026-10-01', file: 'abc.jpg' }]);
  assert.equal(deletePhoto(db, photo), 'abc.jpg');
  assert.deepEqual(listPhotos(db), []);
  assert.throws(() => deletePhoto(db, photo), /Not found/);
});

test('progress groups photo and starred-value days by month, body weight by default', () => {
  const db = openDb(':memory:');
  addMeasurement(db, { preset: 'body-weight' }, 80, '2026-09-20');
  addMeasurement(db, { preset: 'body-weight' }, 79, '2026-10-02');
  const waist = addMeasurement(db, { preset: 'waist' }, 82, '2026-10-05').seriesId;
  addPhoto(db, '2026-10-05', 'a.jpg');
  addPhoto(db, '2026-10-05', 'b.jpg');
  addPhoto(db, '2026-09-28', 'c.jpg');
  const view = () => progress(db).map((m) => [m.month, m.photo?.file, m.days.map((d) => `${d.date} ${d.photos.length} ${d.values.map((v) => `${v.name} ${v.value}`).join()}`)]);

  assert.deepEqual(view(), [
    ['2026-10', 'b.jpg', ['2026-10-05 2 ', '2026-10-02 0 Body weight 79']],
    ['2026-09', 'c.jpg', ['2026-09-28 1 ', '2026-09-20 0 Body weight 80']],
  ]);
  starSeries(db, waist, true);
  assert.equal(listSeries(db).find((s) => s.id === waist)?.starred, true);
  assert.deepEqual(view(), [
    ['2026-10', 'b.jpg', ['2026-10-05 2 Waist 82']],
    ['2026-09', 'c.jpg', ['2026-09-28 1 ']],
  ]);
});
