import { DatabaseSync } from 'node:sqlite';

import type { Db, Row } from '../src/data/db.ts';
import { migrate } from '../src/data/schema.ts';

const wrap = (sqlite: DatabaseSync): Db => ({
  all: (sql, params = []) => sqlite.prepare(sql).all(...params) as Row[],
  run: (sql, params = []) => void sqlite.prepare(sql).run(...params),
});

export const openDb = (path: string): Db => {
  const db = wrap(new DatabaseSync(path));
  migrate(db);
  return db;
};

export const readDb = (path: string) => wrap(new DatabaseSync(path, { readOnly: true }));
