import { Router } from 'express';
import { z } from 'zod';
import type { Db, Queryable } from '../db.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import {
  PROJECT_VISIBLE, assertOrgMember, canManageProject, getProject, isProjectMember, requireRole, seesAllProjects,
} from '../lib/scope.js';
import { logActivity, notify } from '../lib/events.js';
import { PRIORITY_WEIGHT, TASK_CARD, TASK_FROM } from '../lib/taskSql.js';

export const STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const LABEL_COLORS = ['sage', 'ochre', 'plum', 'moss', 'clay', 'olive', 'amber', 'aubergine'] as const;

export const taskInput = z.object({
  title: z.string().trim().min(1, 'A task needs a title').max(200),
  description: z.string().max(5000).default(''),
  status: z.enum(STATUSES).default('todo'),
  priority: z.enum(PRIORITIES).default('medium'),
  assigneeId: z.number().int().nullable().default(null),
  dueAt: z.string().datetime({ offset: true, message: 'Pick a valid date' }).nullable().default(null),
  parentId: z.number().int().nullable().default(null),
  labelIds: z.array(z.number().int()).default([]),
  milestoneId: z.number().int().nullable().default(null),
});

/** A milestone must belong to the same project as the task. */
export async function assertMilestone(q: Queryable, projectId: number, milestoneId: number | null | undefined) {
  if (milestoneId == null) return;
  const { rows } = await q.query('SELECT 1 FROM milestones WHERE id = $1 AND project_id = $2', [milestoneId, projectId]);
  if (!rows[0]) throw new HttpError(400, 'That milestone is not part of this project', { milestoneId: 'Not in this project' });
}

async function resolveWorkspace(q: Queryable, orgId: number, workspaceId: number | null) {
  const { rows } = workspaceId
    ? await q.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [workspaceId, orgId])
    : await q.query('SELECT id FROM workspaces WHERE org_id = $1 ORDER BY id LIMIT 1', [orgId]);
  if (!rows[0]) throw notFound('Workspace not found');
  return rows[0].id as number;
}

/** An assignee must belong to the project, otherwise they could not even see the task. */
export async function assertAssignable(q: Queryable, orgId: number, projectId: number, userId: number | null) {
  if (userId == null) return;
  await assertOrgMember(q, orgId, userId);
  if (!(await isProjectMember(q, projectId, userId))) {
    throw new HttpError(400, 'Add that person to the project before assigning work to them', { assigneeId: 'Not on this project' });
  }
}

export async function assertLabels(q: Queryable, projectId: number, labelIds: number[]) {
  if (!labelIds.length) return;
  const { rows } = await q.query('SELECT count(*)::int AS n FROM labels WHERE project_id = $1 AND id = ANY($2::int[])', [projectId, labelIds]);
  if (rows[0].n !== new Set(labelIds).size) throw new HttpError(400, 'One of those labels does not belong to this project');
}

/** Mounted at /api/orgs/:orgId/projects */
export function projectRoutes(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const includeArchived = req.query.archived === '1';
    const { rows } = await db.query(
      `SELECT p.id, p.name, p.description, p.status, p.team_id, tm.name AS team_name, p.created_at,
         p.workspace_id, w.name AS workspace_name,
         (SELECT count(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.archived = false) AS task_count,
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.archived = false AND t.status = 'done') AS done_count,
         (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.archived = false AND t.status <> 'done'
            AND t.due_at IS NOT NULL AND t.due_at < now()) AS overdue_count,
         EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $2) AS is_member
       FROM projects p LEFT JOIN teams tm ON tm.id = p.team_id JOIN workspaces w ON w.id = p.workspace_id
       WHERE ${PROJECT_VISIBLE('$1', '$2', '$3')} AND ($4::boolean OR p.status = 'active')
         AND ($5::int IS NULL OR p.workspace_id = $5)
       ORDER BY w.name, p.status, p.name`,
      [req.org!.id, req.user!.id, seesAllProjects(req.org!.role), includeArchived, req.query.workspace ? Number(req.query.workspace) : null],
    );
    res.json({ projects: rows });
  });

  r.post('/', requireRole('owner', 'manager'), async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2, 'Give the project a name').max(100),
      description: z.string().max(2000).default(''),
      teamId: z.number().int().nullable().default(null),
      workspaceId: z.number().int().nullable().default(null),
      memberIds: z.array(z.number().int()).default([]),
    }), req.body);
    const project = await db.tx(async (q) => {
      const workspaceId = await resolveWorkspace(q, req.org!.id, body.workspaceId);
      if (body.teamId) {
        const t = await q.query('SELECT 1 FROM teams WHERE id = $1 AND org_id = $2', [body.teamId, req.org!.id]);
        if (!t.rows[0]) throw notFound('Team not found');
      }
      const p = (await q.query(
        'INSERT INTO projects (org_id, team_id, workspace_id, name, description, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [req.org!.id, body.teamId, workspaceId, body.name, body.description, req.user!.id],
      )).rows[0];
      const members = new Set([req.user!.id, ...body.memberIds]);
      if (body.teamId) {
        const tm = await q.query('SELECT user_id FROM team_members WHERE team_id = $1', [body.teamId]);
        tm.rows.forEach((x) => members.add(x.user_id));
      }
      for (const uid of members) {
        await assertOrgMember(q, req.org!.id, uid);
        await q.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [p.id, uid]);
      }
      // Every project starts with a few friendly labels.
      for (const [name, color] of [['Bug', 'clay'], ['Feature', 'moss'], ['Research', 'plum']]) {
        await q.query('INSERT INTO labels (org_id, project_id, name, color) VALUES ($1, $2, $3, $4)', [req.org!.id, p.id, name, color]);
      }
      await logActivity(q, { orgId: req.org!.id, projectId: p.id, actorId: req.user!.id, type: 'project.created', data: { name: p.name } });
      return p;
    });
    res.status(201).json({ project });
  });

  r.get('/:projectId', async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const [members, labels, stats, milestones, workspace] = await Promise.all([
      db.query(
        `SELECT u.id, u.name, u.email, m.role FROM project_members pm
         JOIN users u ON u.id = pm.user_id JOIN memberships m ON m.user_id = u.id AND m.org_id = $2
         WHERE pm.project_id = $1 ORDER BY u.name`, [p.id, req.org!.id]),
      db.query('SELECT id, name, color FROM labels WHERE project_id = $1 ORDER BY name', [p.id]),
      db.query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE t.status = 'done')::int AS done,
           count(*) FILTER (WHERE t.status <> 'done' AND t.due_at IS NOT NULL AND t.due_at < now())::int AS overdue,
           COALESCE(sum(${PRIORITY_WEIGHT}), 0)::int AS weight_total,
           COALESCE(sum(${PRIORITY_WEIGHT}) FILTER (WHERE t.status = 'done'), 0)::int AS weight_done
         FROM tasks t WHERE t.project_id = $1 AND t.parent_id IS NULL AND t.archived = false`, [p.id]),
      db.query(
        `SELECT m.id, m.name, m.due_at,
           count(t.id)::int AS total, count(t.id) FILTER (WHERE t.status = 'done')::int AS done,
           count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_at < now())::int AS overdue
         FROM milestones m LEFT JOIN tasks t ON t.milestone_id = m.id AND t.parent_id IS NULL AND t.archived = false
         WHERE m.project_id = $1 GROUP BY m.id ORDER BY m.due_at NULLS LAST, m.id`, [p.id]),
      db.query('SELECT id, name FROM workspaces WHERE id = $1', [p.workspace_id]),
    ]);
    const s = stats.rows[0];
    res.json({
      project: p,
      members: members.rows,
      labels: labels.rows,
      stats: {
        total: s.total, done: s.done, overdue: s.overdue,
        progress: s.total ? s.done / s.total : 0,
        weightedProgress: s.weight_total ? s.weight_done / s.weight_total : 0,
      },
      milestones: milestones.rows.map((m) => ({ ...m, progress: m.total ? m.done / m.total : null })),
      workspace: workspace.rows[0],
      canManage: canManageProject(req),
    });
  });

  r.patch('/:projectId', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const body = parse(z.object({
      name: z.string().trim().min(2).max(100).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['active', 'archived']).optional(),
      workspaceId: z.number().int().optional(),
    }), req.body);
    const workspaceId = body.workspaceId ? await resolveWorkspace(db, req.org!.id, body.workspaceId) : null;
    const { rows } = await db.query(
      `UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description), status = COALESCE($4, status),
         workspace_id = COALESCE($5, workspace_id)
       WHERE id = $1 RETURNING *`,
      [p.id, body.name ?? null, body.description ?? null, body.status ?? null, workspaceId],
    );
    await logActivity(db, { orgId: req.org!.id, projectId: p.id, actorId: req.user!.id, type: 'project.updated', data: body });
    res.json({ project: rows[0] });
  });

  r.post('/:projectId/members', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const { userId } = parse(z.object({ userId: z.number().int() }), req.body);
    await assertOrgMember(db, req.org!.id, userId);
    await db.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, userId]);
    const u = (await db.query('SELECT name FROM users WHERE id = $1', [userId])).rows[0];
    await logActivity(db, { orgId: req.org!.id, projectId: p.id, actorId: req.user!.id, type: 'project.member_added', data: { name: u.name } });
    res.status(201).json({ ok: true });
  });

  r.delete('/:projectId/members/:userId', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const userId = idParam(req.params.userId);
    await db.tx(async (q) => {
      await q.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [p.id, userId]);
      await q.query(`UPDATE tasks SET assignee_id = NULL, version = version + 1, updated_at = now()
                     WHERE project_id = $1 AND assignee_id = $2 AND status <> 'done'`, [p.id, userId]);
    });
    res.json({ ok: true });
  });

  // ---------- Milestones ----------
  const milestoneBody = z.object({
    name: z.string().trim().min(2, 'Give the milestone a name').max(80),
    dueAt: z.string().datetime({ offset: true, message: 'Pick a valid date' }).nullable().default(null),
  });

  r.post('/:projectId/milestones', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const body = parse(milestoneBody, req.body);
    const { rows } = await db.query(
      'INSERT INTO milestones (org_id, project_id, name, due_at) VALUES ($1, $2, $3, $4) RETURNING id, name, due_at',
      [req.org!.id, p.id, body.name, body.dueAt],
    );
    await logActivity(db, { orgId: req.org!.id, projectId: p.id, actorId: req.user!.id, type: 'milestone.created', data: { name: body.name } });
    res.status(201).json({ milestone: rows[0] });
  });

  r.patch('/:projectId/milestones/:milestoneId', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const body = parse(milestoneBody.partial(), req.body);
    const { rows } = await db.query(
      `UPDATE milestones SET name = COALESCE($3, name), due_at = CASE WHEN $4 THEN $5::timestamptz ELSE due_at END
       WHERE id = $1 AND project_id = $2 RETURNING id, name, due_at`,
      [idParam(req.params.milestoneId), p.id, body.name ?? null, body.dueAt !== undefined, body.dueAt ?? null],
    );
    if (!rows[0]) throw notFound('Milestone not found');
    res.json({ milestone: rows[0] });
  });

  r.delete('/:projectId/milestones/:milestoneId', requireRole('owner', 'manager'), async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const { rows } = await db.query('DELETE FROM milestones WHERE id = $1 AND project_id = $2 RETURNING name',
      [idParam(req.params.milestoneId), p.id]);
    if (!rows[0]) throw notFound('Milestone not found');
    await logActivity(db, { orgId: req.org!.id, projectId: p.id, actorId: req.user!.id, type: 'milestone.deleted', data: { name: rows[0].name } });
    res.json({ ok: true });
  });

  // ---------- Labels ----------
  r.post('/:projectId/labels', async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const body = parse(z.object({ name: z.string().trim().min(1, 'Name the label').max(30), color: z.enum(LABEL_COLORS).default('sage') }), req.body);
    const { rows } = await db.query(
      'INSERT INTO labels (org_id, project_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id, name, color',
      [req.org!.id, p.id, body.name, body.color],
    );
    res.status(201).json({ label: rows[0] });
  });

  // ---------- Tasks ----------
  r.get('/:projectId/tasks', async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const where = ['t.project_id = $1', 't.org_id = $2', 't.parent_id IS NULL', 't.archived = false'];
    const params: unknown[] = [p.id, req.org!.id];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    const q = String(req.query.q ?? '').trim();
    if (q) add(`(t.title ILIKE ? OR t.description ILIKE $${params.length + 1})`, `%${q}%`);
    if (req.query.assignee === 'me') add('t.assignee_id = ?', req.user!.id);
    else if (req.query.assignee === 'none') where.push('t.assignee_id IS NULL');
    else if (req.query.assignee) add('t.assignee_id = ?', Number(req.query.assignee));
    if (req.query.priority && (PRIORITIES as readonly string[]).includes(String(req.query.priority))) add('t.priority = ?', req.query.priority);
    if (req.query.label) add('EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)', Number(req.query.label));
    if (req.query.overdue === '1') where.push(`t.status <> 'done' AND t.due_at < now()`);
    if (req.query.milestone === 'none') where.push('t.milestone_id IS NULL');
    else if (req.query.milestone) add('t.milestone_id = ?', Number(req.query.milestone));
    const { rows } = await db.query(
      `SELECT ${TASK_CARD} ${TASK_FROM} WHERE ${where.join(' AND ')} ORDER BY t.status, t.position, t.id`, params,
    );
    res.json({ tasks: rows });
  });

  r.post('/:projectId/tasks', async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    if (p.status === 'archived') throw new HttpError(409, 'This project is archived. Restore it to add tasks.');
    const body = parse(taskInput, req.body);
    const task = await db.tx(async (q) => {
      await assertAssignable(q, req.org!.id, p.id, body.assigneeId);
      await assertLabels(q, p.id, body.labelIds);
      await assertMilestone(q, p.id, body.milestoneId);
      if (body.parentId) {
        const parent = (await q.query('SELECT id, parent_id FROM tasks WHERE id = $1 AND project_id = $2 AND archived = false', [body.parentId, p.id])).rows[0];
        if (!parent) throw notFound('Parent task not found');
        if (parent.parent_id) throw new HttpError(400, 'Subtasks cannot have their own subtasks');
      }
      const pos = (await q.query(
        'SELECT COALESCE(max(position), 0) + 1024 AS pos FROM tasks WHERE project_id = $1 AND status = $2', [p.id, body.status],
      )).rows[0].pos;
      const t = (await q.query(
        `INSERT INTO tasks (org_id, project_id, parent_id, title, description, status, priority, assignee_id, due_at, position, created_by, milestone_id, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $6 = 'done' THEN now() END) RETURNING id, title`,
        [req.org!.id, p.id, body.parentId, body.title, body.description, body.status, body.priority, body.assigneeId, body.dueAt, pos, req.user!.id, body.milestoneId],
      )).rows[0];
      for (const lid of new Set(body.labelIds)) await q.query('INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)', [t.id, lid]);
      await logActivity(q, {
        orgId: req.org!.id, projectId: p.id, taskId: body.parentId ?? t.id, actorId: req.user!.id,
        type: body.parentId ? 'subtask.created' : 'task.created', data: { title: t.title },
      });
      await notify(q, {
        orgId: req.org!.id, actorId: req.user!.id, recipients: [body.assigneeId], type: 'assigned',
        taskId: t.id, projectId: p.id, message: `${req.user!.name} assigned you "${t.title}"`,
      });
      return (await q.query(`SELECT ${TASK_CARD} ${TASK_FROM} WHERE t.id = $1`, [t.id])).rows[0];
    });
    res.status(201).json({ task });
  });

  r.get('/:projectId/activity', async (req, res) => {
    const p = await getProject(db, req, idParam(req.params.projectId));
    const { rows } = await db.query(
      `SELECT a.id, a.type, a.data, a.task_id, a.created_at, u.name AS actor_name, t.title AS task_title
       FROM activity_events a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tasks t ON t.id = a.task_id
       WHERE a.project_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC, a.id DESC LIMIT 80`,
      [p.id, req.org!.id],
    );
    res.json({ activity: rows });
  });

  return r;
}
