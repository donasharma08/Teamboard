/**
 * Email channel.
 *
 * Which notifications become email: only 'assigned' and 'overdue' — the ones a person must not miss.
 * Comments and status changes stay in-app, to keep inboxes quiet.
 *
 * Delivery: a worker picks up 'pending' rows every minute.
 *  - SMTP_URL set   → sent with nodemailer; failures are retried up to 3 times, then marked 'failed'.
 *  - SMTP_URL unset → marked 'logged': the message is written to the server log and NOT delivered.
 *    This is the documented development mode, and the Reports page counts it separately from 'sent'.
 */
import type { Db, Queryable } from '../db.js';
import { errorDetails, log } from './log.js';

export const EMAIL_TYPES = new Set(['assigned', 'overdue']);
const MAX_ATTEMPTS = 3;

export async function queueEmail(
  q: Queryable,
  e: { orgId: number; userId: number; notificationId: number; subject: string; body: string },
) {
  const u = (await q.query<{ email: string; email_notifications: boolean }>(
    'SELECT email, email_notifications FROM users WHERE id = $1', [e.userId])).rows[0];
  if (!u || !u.email_notifications) return;
  await q.query(
    `INSERT INTO email_outbox (org_id, user_id, notification_id, to_email, subject, body) VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.orgId, e.userId, e.notificationId, u.email, e.subject, e.body],
  );
}

let transport: { sendMail: (m: object) => Promise<unknown> } | null = null;
async function getTransport() {
  if (!process.env.SMTP_URL) return null;
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.default.createTransport(process.env.SMTP_URL);
  }
  return transport;
}

/** Processes pending emails. Returns how many rows it handled. */
export async function deliverEmails(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: number; to_email: string; subject: string; body: string; attempts: number }>(
    `SELECT id, to_email, subject, body, attempts FROM email_outbox WHERE status = 'pending' ORDER BY id LIMIT 50`,
  );
  if (!rows.length) return 0;
  const t = await getTransport();
  for (const m of rows) {
    if (!t) {
      log('info', 'email (not delivered: SMTP_URL is not set)', { to: m.to_email, subject: m.subject });
      await db.query(`UPDATE email_outbox SET status = 'logged', processed_at = now() WHERE id = $1`, [m.id]);
      continue;
    }
    try {
      await t.sendMail({ from: process.env.EMAIL_FROM ?? 'TeamBoard <no-reply@teamboard.local>', to: m.to_email, subject: m.subject, text: m.body });
      await db.query(`UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, processed_at = now() WHERE id = $1`, [m.id]);
    } catch (e) {
      const attempts = m.attempts + 1;
      log('warn', 'email send failed', { id: m.id, attempts, ...errorDetails(e) });
      await db.query(
        `UPDATE email_outbox SET attempts = $2, last_error = $3, status = CASE WHEN $2 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
           processed_at = CASE WHEN $2 >= ${MAX_ATTEMPTS} THEN now() END WHERE id = $1`,
        [m.id, attempts, String((e as Error)?.message ?? e).slice(0, 500)],
      );
    }
  }
  return rows.length;
}
