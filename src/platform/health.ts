import { forgetHealth, healthChanges, markRemoved, markWritten, type HealthRecord } from '@/domain/health';

import { db, readSetting, writeSetting } from './db';
import { healthGranted, healthMissing, removeHealth, requestHealth, writeHealth } from './healthStore';

export { healthMissing, healthName, openHealth } from './healthStore';

const batch = 100;
const on = () => readSetting('health') === 'on';

// A rejected batch is retried one record at a time so one bad record cannot hold back the rest.
const write = async (records: HealthRecord[]) => {
  try {
    await writeHealth(records, Date.now());
    if (on()) markWritten(db, records);
  } catch (e) {
    if (records.length === 1) throw e;
    let error: unknown;
    for (const r of records) await write([r]).catch((e) => (error ??= e));
    if (error) throw error;
  }
};

const sync = async () => {
  if (!on()) return;
  let error = '';
  try {
    const missing = await healthMissing();
    if (missing) throw new Error(missing);
    const kinds = await healthGranted();
    if (!kinds.length) throw new Error('nicereps has no permission to write.');
    const changes = healthChanges(db, kinds);
    for (let i = 0; i < changes.write.length && on(); i += batch) await write(changes.write.slice(i, i + batch)).catch((e) => (error ||= (e as Error).message));
    if (on()) {
      await removeHealth(changes.remove);
      if (on()) markRemoved(db, changes.remove);
    }
    if (on()) writeSetting('healthAt', new Date().toISOString());
    error ||= kinds.length < 2 ? `nicereps has no permission to write ${kinds.includes('workout') ? 'weight' : 'workouts'}.` : '';
  } catch (e) {
    error = (e as Error).message;
  }
  if (on()) writeSetting('healthError', error);
};

let queue = Promise.resolve();
export const syncHealth = () => (queue = queue.then(sync).catch(() => {}));

export const startHealth = async () => {
  const missing = await healthMissing();
  writeSetting('health', 'on');
  if (!missing) await requestHealth();
  await syncHealth();
};

// Forgetting what was written makes turning sync back on rewrite every record; a newer version replaces any still in the store.
export const stopHealth = () => {
  for (const key of ['health', 'healthAt', 'healthError']) writeSetting(key, '');
  forgetHealth(db);
};
