import request from 'supertest';
import { createDb, migrate, type Db } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD } from '../database/seed/seed.js';

/** Fresh in-memory Postgres (PGlite) with the demo data, per test file. */
export async function setup() {
  const db: Db = await createDb({ dir: 'memory' });
  await migrate(db);
  await seed(db);
  const app = createApp(db);
  const ids = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
  const orgs = Object.fromEntries((await ids('SELECT id, name FROM organizations')).map((r) => [r.name, r.id]));
  return { db, app, orgs, ids };
}

/** A signed-in supertest agent (keeps the session cookie). */
export async function as(app: any, email: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return agent;
}
