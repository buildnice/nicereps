import { open } from '@op-engineering/op-sqlite';

import type { Db, Value } from '@/data/db';
import { migrate } from '@/data/schema';
import { getSetting, setSetting } from '@/domain/workouts';

const sqlite = open({ name: 'nicereps.sqlite' });

export const db: Db = {
  all: (sql, params) => sqlite.executeSync(sql, params).rows as Record<string, Value>[],
  run: (sql, params) => void sqlite.executeSync(sql, params),
};

migrate(db);

// Import steps hold a transaction across yields, so imports, exports, backups and health sync take turns.
let queue: Promise<unknown> = Promise.resolve();
export const inTurn = <T>(job: () => Promise<T>) => {
  const next = queue.then(job);
  queue = next.catch(() => {});
  return next;
};

export const readSetting = (key: string) => getSetting(db, key);

export const writeSetting = (key: string, value: string) => setSetting(db, key, value);
