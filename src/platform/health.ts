import { healthChanges, markRemoved, markWritten } from '@/domain/health';

import { db, readSetting, writeSetting } from './db';
import { healthGranted, healthMissing, removeHealth, requestHealth, writeHealth } from './healthStore';

export { healthMissing, healthName, openHealth } from './healthStore';

const batch = 100;

const sync = async () => {
  if (readSetting('health') !== 'on') return;
  try {
    const missing = await healthMissing();
    if (missing) throw new Error(missing);
    const kinds = await healthGranted();
    if (!kinds.length) throw new Error('nicereps has no permission to write.');
    const { write, remove } = healthChanges(db, kinds);
    for (let i = 0; i < write.length; i += batch) {
      const chunk = write.slice(i, i + batch);
      await writeHealth(chunk, Date.now());
      markWritten(db, chunk);
    }
    await removeHealth(remove);
    markRemoved(db, remove);
    writeSetting('healthAt', new Date().toISOString());
    writeSetting('healthError', kinds.length < 2 ? `nicereps has no permission to write ${kinds.includes('workout') ? 'weight' : 'workouts'}.` : '');
  } catch (e) {
    writeSetting('healthError', (e as Error).message);
  }
};

let queue = Promise.resolve();
export const syncHealth = () => (queue = queue.then(sync).catch(() => {}));

export const startHealth = async () => {
  const missing = await healthMissing();
  writeSetting('health', 'on');
  if (!missing) await requestHealth();
  await syncHealth();
};

export const stopHealth = () => {
  for (const key of ['health', 'healthAt', 'healthError']) writeSetting(key, '');
};
