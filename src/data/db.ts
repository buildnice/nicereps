export type Value = string | number | null;
export type Row = Record<string, Value>;

export type Db = {
  all: (sql: string, params?: Value[]) => Row[];
  run: (sql: string, params?: Value[]) => void;
};

export const transaction = <T>(db: Db, fn: () => T): T => {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    return result;
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
};
