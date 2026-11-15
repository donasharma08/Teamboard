/**
 * Organisation scoping — the heart of multi-tenant isolation.
 *
 * Rule 1: every URL that touches tenant data starts with /api/orgs/:orgId.
 * Rule 2: orgScope checks that the signed-in user is a member of that org. If not,
 *         we answer 404 (not 403) so outsiders cannot even learn the org exists.
 * Rule 3: every lookup below filters by req.org.id AND by project visibility,
 *         so an id that belongs to another org simply "does not exist" here.
 */
import type { Request, Response, NextFunction } from 'express';
import type { Db, Queryable } from '../db.js';
import type { Role } from './auth.js';
import { forbidden, notFound } from './http.js';

export function orgScope(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const orgId = Number(req.params.orgId);
    if (!Number.isInteger(orgId) || !req.user) return next(notFound('Organisation not found'));
    const { rows } = await db.query<{ role: Role }>(
      'SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2',
      [orgId, req.user.id],
    );
    if (!rows[0]) return next(notFound('Organisation not found'));
    req.org = { id: orgId, role: rows[0].role };
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.org || !roles.includes(req.org.role)) return next(forbidden());
    next();
  };
}

/** Owners and managers see every project in the org; employees only projects they belong to. */
export const seesAllProjects = (role: Role) => role === 'owner' || role === 'manager';

/** SQL fragment: "this user may see project p". Params: $org, $user, $all. */
export const PROJECT_VISIBLE = (orgParam: string, userParam: string, allParam: string) =>
  `p.org_id = ${orgParam} AND (${allParam}::boolean OR EXISTS (
     SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ${userParam}))`;

export async function getProject(q: Queryable, req: Request, projectId: number) {
  const { rows } = await q.query(
    `SELECT p.* FROM projects p WHERE p.id = $1 AND ${PROJECT_VISIBLE('$2', '$3', '$4')}`,
    [projectId, req.org!.id, req.user!.id, seesAllProjects(req.org!.role)],
  );
  if (!rows[0]) throw notFound('Project not found');
  return rows[0];
}

export async function getTask(q: Queryable, req: Request, taskId: number) {
  const { rows } = await q.query(
    `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.id = $1 AND t.org_id = $2 AND ${PROJECT_VISIBLE('$2', '$3', '$4')}`,
    [taskId, req.org!.id, req.user!.id, seesAllProjects(req.org!.role)],
  );
  if (!rows[0]) throw notFound('Task not found');
  return rows[0];
}

/** Can this person edit project settings and membership? */
export const canManageProject = (req: Request) => seesAllProjects(req.org!.role);

/** Is userId a member of this org? Used before assigning someone or adding them to a project. */
export async function assertOrgMember(q: Queryable, orgId: number, userId: number) {
  const { rows } = await q.query('SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
  if (!rows[0]) throw notFound('That person is not in this organisation');
}

export async function isProjectMember(q: Queryable, projectId: number, userId: number) {
  const { rows } = await q.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  return !!rows[0];
}
