import { createId } from '@paralleldrive/cuid2';

import { transaction, type Db } from '../data/db.ts';
import * as q from '../data/queries.ts';
import type { WeightUnit } from '../data/queries.ts';
import { bodyWeightOn, isDate } from './rules.ts';

export type Kind = 'weight' | 'length';

const tape = (place: string, posture: string, state: string) => [posture, place, state, 'Same time of day, before training.'];
const limb = (side: 'Left' | 'Right', part: string, place: string, state: string, slug: string) => ({
  key: `${side.toLowerCase()}-${slug}`,
  name: `${side} ${part}`,
  kind: 'length' as Kind,
  guide: tape(`Tape around the ${side.toLowerCase()} ${part} ${place}.`, slug.endsWith('arm') ? 'Arm hanging at your side.' : 'Stand with weight on both feet.', state),
});
const limbs = (part: string, place: string, state: string, slug = part) => [limb('Left', part, place, state, slug), limb('Right', part, place, state, slug)];

export const presets: { key: string; name: string; kind: Kind; guide: string[] }[] = [
  { key: 'body-weight', name: 'Body weight', kind: 'weight', guide: ['Weigh after waking, before eating.', 'Same scale on a hard, level floor.', 'Minimal clothing each time.'] },
  { key: 'neck', name: 'Neck', kind: 'length', guide: tape('Tape just below the Adam’s apple, level all round.', 'Stand tall, looking straight ahead.', 'Shoulders relaxed; do not tense.') },
  { key: 'chest', name: 'Chest', kind: 'length', guide: tape('Tape level across the nipples, under the armpits.', 'Stand tall, arms at your sides.', 'Measure after a normal breath out.') },
  { key: 'waist', name: 'Waist', kind: 'length', guide: tape('Tape level at the navel, snug not tight.', 'Stand tall, feet together.', 'Breathe out normally; do not suck in.') },
  { key: 'hips', name: 'Hips', kind: 'length', guide: tape('Tape level around the widest part of the buttocks.', 'Stand tall, feet together.', 'Glutes relaxed.') },
  ...limbs('bicep', 'at its widest, midway from shoulder to elbow', 'Relaxed, not flexed.', 'upper-arm'),
  ...limbs('forearm', 'at its widest, just below the elbow', 'Hand open and relaxed.'),
  ...limbs('thigh', 'at its widest, just below the buttock', 'Relaxed, not flexed.'),
  ...limbs('calf', 'at its widest', 'Relaxed, heel on the floor.'),
];

export const units: Record<Kind, string> = { weight: 'kg', length: 'cm' };

export const listSeries = (db: Db) => {
  const entries = q.measurements(db);
  const order = (preset: string | null) => {
    const i = presets.findIndex((p) => p.key === preset);
    return i < 0 ? presets.length : i;
  };
  return q
    .measurementSeries(db)
    .map((s) => ({
      id: s.id as string,
      name: (presets.find((p) => p.key === s.preset)?.name ?? s.name) as string,
      preset: s.preset as string | null,
      kind: s.kind as Kind,
      starred: s.starred === 1,
      method: s.preset ? (presets.find((p) => p.key === s.preset)?.guide ?? []) : s.method ? [s.method as string] : [],
      entries: entries.filter((e) => e.series_id === s.id).map((e) => ({ id: e.id as string, date: e.date as string, value: e.value as number, unit: e.unit as string })),
    }))
    .sort((a, b) => order(a.preset) - order(b.preset) || a.name.localeCompare(b.name));
};

type Custom = { name: string; kind: Kind; method?: string };

const create = (db: Db, { name, kind, method = '' }: Custom) => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Measurement name is required');
  if (!Object.hasOwn(units, kind)) throw new Error('Kind must be weight or length');
  const taken = [...presets.flatMap((p) => [p.name, p.key]), ...q.measurementSeries(db).map((s) => s.name)].some((n) => String(n).toLowerCase() === trimmed.toLowerCase());
  if (taken) throw new Error(`A measurement named ${trimmed} already exists`);
  const id = createId();
  q.insertSeries(db, id, trimmed, null, kind, method.trim() || null);
  return id;
};

export const createSeries = (db: Db, name: string, kind: Kind, method = '') => transaction(db, () => create(db, { name, kind, method }));

const track = (db: Db, key: string) => {
  const preset = presets.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown measurement preset: ${key}`);
  const existing = q.measurementSeries(db).find((s) => s.preset === key);
  if (existing) return existing.id as string;
  const id = createId();
  q.insertSeries(db, id, preset.name, key, preset.kind, null);
  return id;
};

const check = (value: number, date: string) => {
  if (!(Number.isFinite(value) && value > 0)) throw new Error('Measurement must be a positive number');
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
};

export type Target = { id: string } | { preset: string } | { custom: Custom };

const unitOf = (db: Db, seriesId: string) => {
  const kind = q.measurementSeries(db).find((s) => s.id === seriesId)?.kind as Kind | undefined;
  if (!kind) throw new Error(`Not found: ${seriesId}`);
  return q.readSetting(db, `${kind}Unit`) ?? units[kind];
};

export const add = (db: Db, series: Target, value: number, date: string) => {
  check(value, date);
  const seriesId = 'preset' in series ? track(db, series.preset) : 'custom' in series ? create(db, series.custom) : series.id;
  const id = createId();
  q.insertMeasurement(db, id, seriesId, date, value, unitOf(db, seriesId));
  return { id, seriesId };
};

export const addMeasurement = (db: Db, series: Target, value: number, date: string) => transaction(db, () => add(db, series, value, date));

export const logMeasurements = (db: Db, entries: { series: Target; value: number }[], date: string) =>
  transaction(db, () => entries.map((e) => add(db, e.series, e.value, date)));

export const editMeasurement = (db: Db, id: string, value: number | undefined, date: string) => {
  const entry = q.measurements(db).find((e) => e.id === id);
  if (!entry) throw new Error(`Not found: ${id}`);
  check(value ?? (entry.value as number), date);
  q.updateMeasurement(db, id, value ?? (entry.value as number), value === undefined ? (entry.unit as string) : unitOf(db, entry.series_id as string), date);
};

export const bodyWeights = (db: Db) => {
  const series = q.measurementSeries(db).find((s) => s.preset === 'body-weight');
  return q.measurements(db).filter((e) => e.series_id === series?.id).map((e) => ({ id: e.id as string, date: e.date as string, value: e.value as number, unit: e.unit as WeightUnit }));
};

export const bodyWeightLookup = (db: Db) => {
  const entries = bodyWeights(db);
  return (date: string) => bodyWeightOn(entries, date);
};

export const bodyWeight = (db: Db, date: string) => bodyWeightLookup(db)(date);

export const logBodyWeight = (db: Db, value: number, date: string) => {
  const entry = bodyWeights(db).find((e) => e.date === date);
  return entry ? editMeasurement(db, entry.id, value, date) : addMeasurement(db, { preset: 'body-weight' }, value, date);
};

export const deleteMeasurement = (db: Db, id: string) => q.deleteMeasurement(db, id);

export const deleteSeries = (db: Db, id: string) => q.deleteSeries(db, id);

export const starSeries = (db: Db, id: string, starred: boolean) => q.starSeries(db, id, starred);

export const listPhotos = (db: Db) => q.photos(db).map((p) => ({ id: p.id as string, date: p.date as string, file: p.file as string }));

export const photoName = /^[\w-]+\.\w+$/;

export const addPhoto = (db: Db, date: string, file: string) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  if (!photoName.test(file)) throw new Error(`Invalid photo file: ${file}`);
  const id = createId();
  q.insertPhoto(db, id, date, file);
  return id;
};

export const deletePhoto = (db: Db, id: string) => q.deletePhoto(db, id);

export const progress = (db: Db) => {
  const series = listSeries(db);
  const starred = series.filter((s) => s.starred);
  const shown = starred.length ? starred : series.filter((s) => s.preset === 'body-weight');
  const photos = listPhotos(db);
  const dates = [...new Set([...photos.map((p) => p.date), ...shown.flatMap((s) => s.entries.map((e) => e.date))])].sort().reverse();
  const days = dates.map((date) => ({
    date,
    photos: photos.filter((p) => p.date === date),
    values: shown.flatMap((s) => s.entries.filter((e) => e.date === date).map((e) => ({ name: s.name, kind: s.kind, value: e.value, unit: e.unit }))),
  }));
  return [...new Set(dates.map((d) => d.slice(0, 7)))].map((month) => {
    const inMonth = days.filter((d) => d.date.startsWith(month));
    return { month, photo: inMonth.find((d) => d.photos.length)?.photos.at(-1), days: inMonth };
  });
};
