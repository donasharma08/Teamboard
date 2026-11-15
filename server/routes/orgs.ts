import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db.js';
import { HttpError, idParam, notFound, parse } from '../lib/http.js';
import { PROJECT_VISIBLE, assertOrgMember, requireRole, seesAllProjects } from '../lib/scope.js';
import { logActivity } from '../lib/events.js';

const role = z.enum(['owner', 'manager', 'employee']);

/** Mounted at /api/orgs/:orgId, after requireAuth + orgScope. */
export function orgRoutes(db: Db) {
  const r = Router({ mergeParams: true });

  r.get('/', async (req, res) => {
    const { rows } = await db.query('SELECT id, name, created_at FROM organizations WHERE id = $1', [req.org!.id]);
    res.json({ org: { ...rows[0], role: req.org!.role } });
  });

  // ---------- Members ----------
  r.get('/members', async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, m.role, m.created_at AS joined_at,
         (SELECT count(*)::int FROM tasks t WHERE t.org_id = m.org_id AND t.assignee_id = u.id
            AND t.archived = false AND t.status <> 'done') AS open_tasks
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`,
      [req.org!.id],
    );
    res.json({ members: rows });
  });

  r.post('/members', requireRole('owner'), async (req, res) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email('That email does not look right'), role }), req.body);
    const u = (await db.query('SELECT id, name, email FROM users WHERE email = $1', [body.email])).rows[0];
    if (!u) throw new HttpError(404, 'No one has signed up with that email yet. Ask them to create an account first.', { email: 'No account found' });
    const existing = await db.query('SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org!.id, u.id]);
    if (existing.rows[0]) throw new HttpError(409, `${u.name} is already in this organisation`, { email: 'Already a member' });
    await db.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [req.org!.id, u.id, body.role]);
    await logActivity(db, { orgId: req.org!.id, actorId: req.user!.id, type: 'member.added', data: { name: u.name, role: body.role } });
    res.status(201).json({ member: { ...u, role: body.role } });
  });

  async function ownerCount(orgId: number) {
    return (await db.query(`SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`, [orgId])).rows[0].n as number;
  }

  r.patch('/members/:userId', requireRole('owner'), async (req, res) => {
    const userId = idParam(req.params.userId);
    const body = parse(z.object({ role }), req.body);
    const cur = (await db.query('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org!.id, userId])).rows[0];
    if (!cur) throw notFound('That person is not in this organisation');
    if (cur.role === 'owner' && body.role !== 'owner' && (await ownerCount(req.org!.id)) <= 1) {
      throw new HttpError(409, 'Every organisation needs at least one owner. Make someone else an owner first.');
    }
    await db.query('UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [req.org!.id, userId, body.role]);
    res.json({ ok: true });
  });

  r.delete('/members/:userId', requireRole('owner'), async (req, res) => {
    const userId = idParam(req.params.userId);
    const cur = (await db.query('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org!.id, userId])).rows[0];
    if (!cur) throw notFound('That person is not in this organisation');
    if (cur.role === 'owner' && (await ownerCount(req.org!.id)) <= 1) {
      throw new HttpError(409, 'You are the only owner. Make someone else an owner before leaving.');
    }
    await db.tx(async (q) => {
      await q.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org!.id, userId]);
      await q.query('DELETE FROM project_members WHERE user_id = $2 AND project_id IN (SELECT id FROM projects WHERE org_id = $1)', [req.org!.id, userId]);
      await q.query('DELETE FROM team_members WHERE user_id = $2 AND team_id IN (SELECT id FROM teams WHERE org_id = $1)', [req.org!.id, userId]);
      // Open work goes back to "unassigned" so nothing is silently owned by someone who left.
      await q.query(`UPDATE tasks SET assignee_id = NULL, updated_at = now(), version = version + 1
                     WHERE org_id = $1 AND assignee_id = $2 AND status <> 'done'`, [req.org!.id, userId]);
    });
    res.json({ ok: true });
  });

  // ---------- Workspaces (Organisation → Workspace → Project) ----------
  r.get('/workspaces', async (req, res) => {
    const { rows } = await db.query(
      `SELECT w.id, w.name, w.description,
         (SELECT count(*)::int FROM projects p WHERE p.workspace_id = w.id AND p.status = 'active'
            AND ${PROJECT_VISIBLE('$1', '$2', '$3')}) AS project_count
       FROM workspaces w WHERE w.org_id = $1 ORDER BY w.name`,
      [req.org!.id, req.user!.id, seesAllProjects(req.org!.role)],
    );
    res.json({ workspaces: rows });
  });

  const workspaceBody = z.object({
    name: z.string().trim().min(2, 'Give the workspace a name').max(60),
    description: z.string().max(300).default(''),
  });

  r.post('/workspaces', requireRole('owner', 'manager'), async (req, res) => {
    const body = parse(workspaceBody, req.body);
    const { rows } = await db.query(
      'INSERT INTO workspaces (org_id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description',
      [req.org!.id, body.name, body.description],
    );
    await logActivity(db, { orgId: req.org!.id, actorId: req.user!.id, type: 'workspace.created', data: { name: body.name } });
    res.status(201).json({ workspace: rows[0] });
  });

  r.patch('/workspaces/:workspaceId', requireRole('owner', 'manager'), async (req, res) => {
    const body = parse(workspaceBody.partial(), req.body);
    const { rows } = await db.query(
      `UPDATE workspaces SET name = COALESCE($3, name), description = COALESCE($4, description)
       WHERE id = $1 AND org_id = $2 RETURNING id, name, description`,
      [idParam(req.params.workspaceId), req.org!.id, body.name ?? null, body.description ?? null],
    );
    if (!rows[0]) throw notFound('Workspace not found');
    res.json({ workspace: rows[0] });
  });

  r.delete('/workspaces/:workspaceId', requireRole('owner'), async (req, res) => {
    const id = idParam(req.params.workspaceId);
    const w = (await db.query('SELECT id FROM workspaces WHERE id = $1 AND org_id = $2', [id, req.org!.id])).rows[0];
    if (!w) throw notFound('Workspace not found');
    const used = (await db.query('SELECT count(*)::int AS n FROM projects WHERE workspace_id = $1', [id])).rows[0].n;
    if (used) throw new HttpError(409, 'Move or remove the projects in this workspace first. Archived projects count too.');
    await db.query('DELETE FROM workspaces WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  // ---------- Teams ----------
  r.get('/teams', async (req, res) => {
    const { rows } = await db.query(
      `SELECT t.id, t.name,
         COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                   FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = t.id), '[]') AS members
       FROM teams t WHERE t.org_id = $1 ORDER BY t.name`,
      [req.org!.id],
    );
    res.json({ teams: rows });
  });

  r.post('/teams', requireRole('owner', 'manager'), async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(2, 'Give the team a name').max(60), memberIds: z.array(z.number().int()).default([]) }), req.body);
    const team = await db.tx(async (q) => {
      const t = (await q.query('INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id, name', [req.org!.id, body.name])).rows[0];
      for (const uid of new Set(body.memberIds)) {
        await assertOrgMember(q, req.org!.id, uid);
        await q.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [t.id, uid]);
      }
      return t;
    });
    res.status(201).json({ team });
  });

  r.delete('/teams/:teamId', requireRole('owner', 'manager'), async (req, res) => {
    const teamId = idParam(req.params.teamId);
    await db.tx(async (q) => {
      const t = (await q.query('SELECT id FROM teams WHERE id = $1 AND org_id = $2', [teamId, req.org!.id])).rows[0];
      if (!t) throw notFound('Team not found');
      await q.query('UPDATE projects SET team_id = NULL WHERE team_id = $1 AND org_id = $2', [teamId, req.org!.id]);
      await q.query('DELETE FROM teams WHERE id = $1', [teamId]);
    });
    res.json({ ok: true });
  });

  // ---------- My work ----------
  r.get('/my-work', async (req, res) => {
    const { rows } = await db.query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_at, t.project_id, p.name AS project_name, t.parent_id,
         (t.due_at IS NOT NULL AND t.due_at < now()) AS is_overdue
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.org_id = $1 AND t.assignee_id = $2 AND t.archived = false AND t.status <> 'done'
         AND p.status = 'active' AND ${PROJECT_VISIBLE('$1', '$2', '$3')}
       ORDER BY t.due_at ASC NULLS LAST,
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      [req.org!.id, req.user!.id, seesAllProjects(req.org!.role)],
    );
    const now = Date.now();
    const week = now + 7 * 864e5;
    res.json({
      overdue: rows.filter((t) => t.is_overdue),
      upcoming: rows.filter((t) => !t.is_overdue && t.due_at && new Date(t.due_at).getTime() <= week),
      later: rows.filter((t) => !t.is_overdue && (!t.due_at || new Date(t.due_at).getTime() > week)),
    });
  });

  // ---------- Notifications ----------
  r.get('/notifications', async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id, n.type, n.message, n.task_id, n.project_id, n.read_at, n.created_at
       FROM notifications n WHERE n.org_id = $1 AND n.user_id = $2 ORDER BY n.created_at DESC LIMIT 100`,
      [req.org!.id, req.user!.id],
    );
    res.json({ notifications: rows, unread: rows.filter((n) => !n.read_at).length });
  });

  r.get('/notifications/unread-count', async (req, res) => {
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM notifications WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL',
      [req.org!.id, req.user!.id],
    );
    res.json({ unread: rows[0].n });
  });

  r.post('/notifications/:id/read', async (req, res) => {
    const id = idParam(req.params.id);
    const { rows } = await db.query(
      'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND org_id = $2 AND user_id = $3 RETURNING id',
      [id, req.org!.id, req.user!.id],
    );
    if (!rows[0]) throw notFound('Notification not found');
    res.json({ ok: true });
  });

  r.post('/notifications/read-all', async (req, res) => {
    await db.query('UPDATE notifications SET read_at = now() WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL', [req.org!.id, req.user!.id]);
    res.json({ ok: true });
  });

  return r;
}
