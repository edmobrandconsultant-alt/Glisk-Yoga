import { DatabaseSync } from 'node:sqlite';

// Minimal stand-in for the D1 binding, backed by real SQLite. Enough of the
// surface for the worker's queries, with batch() as a real transaction so the
// occupancy UNIQUE guard is exercised exactly as it would be in production.
export function makeDb(schemaSql) {
  const sq = new DatabaseSync(':memory:');
  sq.exec(schemaSql);

  const run = (sql, params) => {
    const st = sq.prepare(sql);
    if (/^\s*select/i.test(sql)) return st.all(...params);
    return st.run(...params);
  };

  const stmt = (sql, params = []) => ({
    bind: (...args) => stmt(sql, args),
    all: async () => ({ results: run(sql, params) }),
    first: async () => { const r = run(sql, params); return r[0] ?? null; },
    run: async () => run(sql, params),
    _exec: () => run(sql, params),
  });

  return {
    _sq: sq,
    prepare: sql => stmt(sql),
    batch: async statements => {
      sq.exec('BEGIN');
      try {
        const out = statements.map(s => s._exec());
        sq.exec('COMMIT');
        return out;
      } catch (err) {
        sq.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
