/**
 * Productivity reports. Every formula here is written out in docs/METRICS.md.
 * "Eligible task" = a top-level task (not a subtask) that is not archived, in an active project.
 */
import { Router } from 'express';
import type { Db } from '../db.js';
import { HttpError, notFound } from '../lib/http.js';
import { requireRole } from '../lib/scope.js';
import { PRIORITY_WEIGHT } from '../lib/taskSql.js';

const ratio = (num: number, den: number) => ({ num, den, value: den ? num / den : null });

export function reportRoutes(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', requireRole('owner', 'manager'), async (req, res) => {
    const orgId = req.org!.id;
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 864e5);
    if (isNaN(+from) || isNaN(+to) || from > to) throw new HttpError(400, 'Pick a start date that is before the end date');
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    const workspaceId = req.query.workspaceId ? Number(req.query.workspaceId) : null;
    // Scope: one project, every project in one workspace, or the whole organisation (null).
    let scope: number[] | null = null;
    if (projectId) {
      const ok = await db.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = $2', [projectId, orgId]);
      if (!ok.rows[0]) throw notFound('Project not found');
      scope = [projectId];
    } else if (workspaceId) {
      const ok = await db.query('SELECT 1 FROM workspaces WHERE id = $1 AND org_id = $2', [workspaceId, orgId]);
      if (!ok.rows[0]) throw notFound('Workspace not found');
      scope = (await db.query('SELECT id FROM projects WHERE workspace_id = $1 AND org_id = $2', [workspaceId, orgId])).rows.map((x) => x.id);
    }
    // $1 org, $2 project ids (null = all), $3 from, $4 to
    const P = [orgId, scope, from.toISOString(), to.toISOString()];
    const P2 = [orgId, scope]; // Postgres rejects parameters a statement does not use
    const P3 = [orgId, scope, to.toISOString()];
    const ELIGIBLE = `t.org_id = $1 AND t.parent_id IS NULL AND t.archived = false
      AND ($2::int[] IS NULL OR t.project_id = ANY($2::int[])) AND p.status = 'active'`;
    const FROM = `FROM tasks t JOIN projects p ON p.id = t.project_id`;

    const [cohort, ontime, current, byStatus, workload, trend, projects, notif, email] = await Promise.all([
      db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE t.status = 'done')::int AS done
                ${FROM} WHERE ${ELIGIBLE} AND t.created_at BETWEEN $3 AND $4`, P),
      db.query(`SELECT count(*)::int AS completed, count(*) FILTER (WHERE t.completed_at <= t.due_at)::int AS on_time
                ${FROM} WHERE ${ELIGIBLE} AND t.status = 'done' AND t.due_at IS NOT NULL AND t.completed_at BETWEEN $3 AND $4`, P),
      db.query(`SELECT count(*) FILTER (WHERE t.status <> 'done')::int AS active,
                       count(*) FILTER (WHERE t.status <> 'done' AND t.assignee_id IS NOT NULL)::int AS assigned,
                       count(*) FILTER (WHERE t.status <> 'done' AND t.due_at < now())::int AS overdue,
                       count(*)::int AS total, count(*) FILTER (WHERE t.status = 'done')::int AS done,
                       COALESCE(sum(${PRIORITY_WEIGHT}), 0)::int AS weight_total,
                       COALESCE(sum(${PRIORITY_WEIGHT}) FILTER (WHERE t.status = 'done'), 0)::int AS weight_done
                ${FROM} WHERE ${ELIGIBLE}`, P2),
      db.query(`SELECT t.status, count(*)::int AS n ${FROM} WHERE ${ELIGIBLE} GROUP BY t.status`, P2),
      db.query(`SELECT u.id, u.name, m.role,
                  count(t.id) FILTER (WHERE t.status <> 'done')::int AS open,
                  count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_at < now())::int AS overdue,
                  count(t.id) FILTER (WHERE t.status = 'done' AND t.completed_at BETWEEN $3 AND $4)::int AS completed
                FROM memberships m JOIN users u ON u.id = m.user_id
                LEFT JOIN (tasks t JOIN projects p ON p.id = t.project_id)
                  ON t.assignee_id = u.id AND ${ELIGIBLE}
                WHERE m.org_id = $1 GROUP BY u.id, u.name, m.role ORDER BY open DESC, u.name`, P),
      db.query(`SELECT to_char(w, 'YYYY-MM-DD') AS week,
                  (SELECT count(*)::int ${FROM} WHERE ${ELIGIBLE} AND t.status = 'done'
                     AND t.completed_at >= w AND t.completed_at < w + interval '7 days') AS completed,
                  (SELECT count(*)::int ${FROM} WHERE ${ELIGIBLE}
                     AND t.created_at >= w AND t.created_at < w + interval '7 days') AS created
                FROM generate_series(date_trunc('week', $3::timestamptz) - interval '7 weeks',
                                     date_trunc('week', $3::timestamptz), interval '1 week') AS w
                ORDER BY w`, P3),
      db.query(`SELECT p.id, p.name,
                  count(t.id)::int AS total, count(t.id) FILTER (WHERE t.status = 'done')::int AS done,
                  count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_at < now())::int AS overdue
                FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.parent_id IS NULL AND t.archived = false
                WHERE p.org_id = $1 AND p.status = 'active' AND ($2::int[] IS NULL OR p.id = ANY($2::int[]))
                GROUP BY p.id, p.name ORDER BY p.name`, P2),
      db.query(`SELECT count(*)::int AS created, count(*) FILTER (WHERE read_at IS NOT NULL)::int AS read
                FROM notifications WHERE org_id = $1 AND ($2::int[] IS NULL OR project_id = ANY($2::int[])) AND created_at BETWEEN $3 AND $4`, P),
      db.query(`SELECT e.status, count(*)::int AS n FROM email_outbox e LEFT JOIN notifications n ON n.id = e.notification_id
                WHERE e.org_id = $1 AND ($2::int[] IS NULL OR n.project_id = ANY($2::int[])) AND e.created_at BETWEEN $3 AND $4
                GROUP BY e.status`, P),
    ]);

    const c = current.rows[0];
    res.json({
      window: { from: from.toISOString(), to: to.toISOString(), projectId, workspaceId },
      metrics: {
        completionRate: ratio(cohort.rows[0].done, cohort.rows[0].total),
        onTimeRate: ratio(ontime.rows[0].on_time, ontime.rows[0].completed),
        overdueCount: c.overdue,
        assignmentCoverage: ratio(c.assigned, c.active),
        progress: ratio(c.done, c.total),
        weightedProgress: ratio(c.weight_done, c.weight_total),
        notifications: {
          inApp: notif.rows[0],
          email: Object.fromEntries(['sent', 'logged', 'failed', 'pending'].map((k) => [k, email.rows.find((x) => x.status === k)?.n ?? 0])),
          emailConfigured: !!process.env.SMTP_URL,
        },
      },
      statusDistribution: ['todo', 'in_progress', 'review', 'done'].map((s) => ({
        status: s, count: byStatus.rows.find((x) => x.status === s)?.n ?? 0,
      })),
      workload: workload.rows,
      trend: trend.rows,
      projects: projects.rows.map((p) => ({ ...p, progress: p.total ? p.done / p.total : null })),
    });
  });

  return r;
}
