/**
 * Database adapter.
 *
 * - No DATABASE_URL  → PGlite: a real PostgreSQL engine compiled to WebAssembly,
 *   running inside this Node process. Nothing to install. Data lives in ./.data/pglite
 *   (or in memory when PGLITE_DIR=memory, which the tests use).
 * - DATABASE_URL set → node-postgres Pool against any real PostgreSQL (Neon, Supabase, local).
 *
 * Both expose the same tiny interface, so every query in the app is plain SQL with $1 params.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Queryable {
  /** Run several statements atomically. Throwing inside rolls everything back. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export async function createDb(opts: { url?: string; dir?: string } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({
      connectionString: url,
      ssl: /sslmode=require|neon\.tech|supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    return {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      exec: async (sql) => { await pool.query(sql); },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (s, p) => client.query(s, p as any[]) as any });
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = opts.dir ?? process.env.PGLITE_DIR ?? path.join(ROOT, '.data', 'pglite');
  let pg;
  if (dir === 'memory') {
    pg = new PGlite();
  } else {
    fs.mkdirSync(dir, { recursive: true });
    pg = new PGlite(dir);
  }
  await pg.waitReady;
  // PGlite runs one query at a time; a simple promise queue keeps transactions from interleaving.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job, job);
    chain = run.catch(() => undefined);
    return run;
  };
  return {
    kind: 'pglite',
    query: (sql, params) => serial(() => pg.query(sql, params as any[]) as any),
    exec: (sql) => serial(async () => { await pg.exec(sql); }),
    tx: (fn) => serial(() => pg.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) as any }))),
    close: () => pg.close(),
  };
}

/** Applies every database/migrations/*.sql file that has not run yet, in filename order. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(ROOT, 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.exec(`BEGIN; ${sql}; INSERT INTO schema_migrations(name) VALUES ('${file}'); COMMIT;`);
    applied.push(file);
  }
  return applied;
}
