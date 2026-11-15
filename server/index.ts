import { createDb, migrate } from './db.js';
import { createApp } from './app.js';
import { scanOverdue } from './lib/events.js';
import { deliverEmails } from './lib/email.js';
import { errorDetails, log } from './lib/log.js';
import { isEmpty, seed, DEMO_PASSWORD } from '../database/seed/seed.js';

const PORT = Number(process.env.PORT ?? 3000);

const db = await createDb();
const applied = await migrate(db);
if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
if (process.env.SEED_ON_EMPTY !== '0' && (await isEmpty(db))) {
  await seed(db);
  console.log(`[db] empty database → loaded demo data (password for every demo user: ${DEMO_PASSWORD})`);
}

// Overdue alerts: scan now, then every 5 minutes. Dedupe keys make repeat scans harmless.
const scan = () => scanOverdue(db).catch((e) => log('error', 'overdue scan failed', errorDetails(e)));
await scan();
setInterval(scan, 5 * 60 * 1000).unref();

// Email worker: sends (or, without SMTP_URL, logs) queued emails every minute.
const mail = () => deliverEmails(db).catch((e) => log('error', 'email worker failed', errorDetails(e)));
await mail();
setInterval(mail, 60 * 1000).unref();

process.on('unhandledRejection', (e) => log('error', 'unhandled promise rejection', errorDetails(e)));

createApp(db).listen(PORT, () => {
  console.log(`[api] TeamBoard API on http://localhost:${PORT}  (database: ${db.kind})`);
  if (process.env.NODE_ENV !== 'production') console.log('[web] open http://localhost:5173');
});
