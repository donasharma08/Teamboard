/** npm run seed — wipes the database and loads fresh demo data. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, createDb, migrate } from '../../server/db.js';
import { seed, DEMO_PASSWORD } from './seed.js';

if (!process.env.DATABASE_URL) {
  fs.rmSync(path.join(ROOT, '.data', 'pglite'), { recursive: true, force: true });
}
const db = await createDb();
if (db.kind === 'postgres') await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
fs.rmSync(path.join(ROOT, 'storage', 'uploads'), { recursive: true, force: true });
await migrate(db);
await seed(db);
console.log(`Seeded. Sign in as asha@saffron.test / ${DEMO_PASSWORD} (or any demo user).`);
await db.close();
