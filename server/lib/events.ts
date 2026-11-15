import type { Db, Queryable } from '../db.js';
import { EMAIL_TYPES, queueEmail } from './email.js';

export async function logActivity(
  q: Queryable,
  e: { orgId: number; projectId?: number | null; taskId?: number | null; actorId: number | null; type: string; data?: object },
) {
  await q.query(
    `INSERT INTO activity_events (org_id, project_id, task_id, actor_id, type, data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [e.orgId, e.projectId ?? null, e.taskId ?? null, e.actorId, e.type, JSON.stringify(e.data ?? {})],
  );
}

type NotificationType = 'assigned' | 'comment' | 'due_changed' | 'overdue' | 'status';

/**
 * Creates in-app notifications. Noise rules:
 *  - never notify the person who did the action
 *  - each recipient gets one notification per event (Set dedupes)
 *  - dedupeKey makes repeat alerts (like the overdue scan) a no-op
 */
export async function notify(
  q: Queryable,
  n: {
    orgId: number; actorId: number | null; recipients: (number | null | undefined)[]; type: NotificationType;
    message: string; taskId?: number; projectId?: number; dedupeKey?: string;
  },
) {
  const people = new Set(n.recipients.filter((r): r is number => !!r && r !== n.actorId));
  for (const userId of people) {
    const { rows } = await q.query<{ id: number }>(
      `INSERT INTO notifications (org_id, user_id, type, task_id, project_id, message, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [n.orgId, userId, n.type, n.taskId ?? null, n.projectId ?? null, n.message,
       n.dedupeKey ? `${n.dedupeKey}:u${userId}` : null],
    );
    // Only a newly created notification can produce an email, so de-duplication covers email too.
    if (rows[0] && EMAIL_TYPES.has(n.type)) {
      await queueEmail(q, {
        orgId: n.orgId, userId, notificationId: rows[0].id,
        subject: n.type === 'overdue' ? `Running late: ${n.message}` : n.message,
        body: `${n.message}\n\nOpen TeamBoard to see the task.\n\nYou get emails only for new assignments and overdue work.`,
      });
    }
  }
}

/**
 * Overdue rule (documented in docs/METRICS.md):
 * a task is overdue when it is not archived, not done, has a due date, and due_at < now() in UTC.
 * The dedupe key includes the due date, so moving the deadline and missing it again alerts once more.
 */
export async function scanOverdue(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: number; org_id: number; project_id: number; title: string; assignee_id: number; due_at: Date }>(
    `SELECT id, org_id, project_id, title, assignee_id, due_at FROM tasks
     WHERE archived = false AND status <> 'done' AND due_at IS NOT NULL AND due_at < now() AND assignee_id IS NOT NULL`,
  );
  for (const t of rows) {
    await notify(db, {
      orgId: t.org_id, actorId: null, recipients: [t.assignee_id], type: 'overdue',
      taskId: t.id, projectId: t.project_id,
      message: `"${t.title}" is past its due date`,
      dedupeKey: `overdue:${t.id}:${new Date(t.due_at).toISOString()}`,
    });
  }
  return rows.length;
}
