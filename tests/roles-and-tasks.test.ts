import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { as, setup } from './helpers.js';
import { scanOverdue } from '../server/lib/events.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let S: number;
let website: number;
let mobile: number;
let user: Record<string, number>;
let asha: any, kabir: any, meera: any, rohan: any;

beforeAll(async () => {
  ctx = await setup();
  S = ctx.orgs['Saffron Studio'];
  website = (await ctx.ids(`SELECT id FROM projects WHERE name = 'Website relaunch'`))[0].id;
  mobile = (await ctx.ids(`SELECT id FROM projects WHERE name = 'Mobile app v2'`))[0].id;
  user = Object.fromEntries((await ctx.ids('SELECT id, email FROM users')).map((r) => [r.email.split('@')[0], r.id]));
  [asha, kabir, meera, rohan] = await Promise.all(['asha', 'kabir', 'meera', 'rohan'].map((n) => as(ctx.app, `${n}@saffron.test`)));
});
afterAll(() => ctx.db.close());

const taskId = async (title: string) => (await ctx.ids('SELECT id, version FROM tasks WHERE title = $1', [title]))[0];

describe('authentication', () => {
  it('gives the same answer for a wrong email and a wrong password', async () => {
    const a = await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@x.test', password: 'whatever1' });
    const b = await request(ctx.app).post('/api/auth/login').send({ email: 'asha@saffron.test', password: 'wrong-pass' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });
  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const r = await request(ctx.app).post('/api/auth/login').send({ email: 'asha@saffron.test', password: 'password123' });
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
  it('registers a new person as owner of a new org, and never returns the password hash', async () => {
    const r = await request(ctx.app).post('/api/auth/register').send({ name: 'Tara', email: 'tara@new.test', password: 'longenough', orgName: 'Tara Co' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('password');
    const row = (await ctx.ids(`SELECT m.role, u.password_hash FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'tara@new.test'`))[0];
    expect(row.role).toBe('owner');
    expect(row.password_hash).toMatch(/^\$2[aby]\$/); // bcrypt
  });
  it('explains validation problems field by field', async () => {
    const r = await request(ctx.app).post('/api/auth/register').send({ name: 'T', email: 'nope', password: 'short', orgName: '' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.details).sort()).toEqual(['email', 'name', 'orgName', 'password']);
  });
});

describe('roles', () => {
  it('employees only see projects they belong to', async () => {
    const r = await meera.get(`/api/orgs/${S}/projects`);
    expect(r.body.projects.map((p: any) => p.name)).toEqual(['Website relaunch']);
    expect((await meera.get(`/api/orgs/${S}/projects/${mobile}`)).status).toBe(404);
    const t = await taskId('Login with phone number');
    expect((await meera.get(`/api/orgs/${S}/tasks/${t.id}`)).status).toBe(404);
  });
  it("employees do not see tasks from hidden projects in 'my work' either", async () => {
    const r = await meera.get(`/api/orgs/${S}/my-work`);
    const all = [...r.body.overdue, ...r.body.upcoming, ...r.body.later];
    expect(all.every((t: any) => t.project_id === website)).toBe(true);
  });
  it('managers see every project', async () => {
    const r = await kabir.get(`/api/orgs/${S}/projects`);
    expect(r.body.projects).toHaveLength(2);
  });
  it('employees cannot create projects, open reports, or manage people', async () => {
    expect((await meera.post(`/api/orgs/${S}/projects`).send({ name: 'Mine' })).status).toBe(403);
    expect((await meera.get(`/api/orgs/${S}/reports`)).status).toBe(403);
    expect((await meera.patch(`/api/orgs/${S}/members/${user.meera}`).send({ role: 'owner' })).status).toBe(403);
    expect((await meera.post(`/api/orgs/${S}/projects/${website}/members`).send({ userId: user.rohan })).status).toBe(403);
  });
  it('managers cannot change roles; only owners can', async () => {
    expect((await kabir.patch(`/api/orgs/${S}/members/${user.meera}`).send({ role: 'manager' })).status).toBe(403);
  });
  it('the last owner cannot be demoted or removed', async () => {
    expect((await asha.patch(`/api/orgs/${S}/members/${user.asha}`).send({ role: 'employee' })).status).toBe(409);
    expect((await asha.delete(`/api/orgs/${S}/members/${user.asha}`)).status).toBe(409);
  });
  it('employees can only archive tasks they created', async () => {
    const t = await taskId('Choose analytics tool'); // created by Kabir
    expect((await meera.delete(`/api/orgs/${S}/tasks/${t.id}`)).status).toBe(403);
    const mine = await meera.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'Meera scratch task' });
    expect(mine.status).toBe(201);
    expect((await meera.delete(`/api/orgs/${S}/tasks/${mine.body.task.id}`)).status).toBe(200);
    expect((await meera.post(`/api/orgs/${S}/tasks/${mine.body.task.id}/restore`)).status).toBe(200);
  });
  it('work can only be assigned to people on the project', async () => {
    const r = await asha.post(`/api/orgs/${S}/projects/${mobile}/tasks`).send({ title: 'For Meera', assigneeId: user.meera });
    expect(r.status).toBe(400);
    expect(r.body.details.assigneeId).toBeTruthy();
  });
});

describe('task lifecycle', () => {
  it('rejects a stale edit with 409 instead of silently overwriting (two people editing at once)', async () => {
    const t = await taskId('Set up redirects from old URLs');
    const first = await kabir.patch(`/api/orgs/${S}/tasks/${t.id}`).send({ title: 'Redirects (Kabir)', version: t.version });
    expect(first.status).toBe(200);
    const second = await rohan.patch(`/api/orgs/${S}/tasks/${t.id}`).send({ title: 'Redirects (Rohan)', version: t.version });
    expect(second.status).toBe(409);
    expect(second.body.details.current.title).toBe('Redirects (Kabir)');
  });
  it('stamps completed_at when done, clears it when reopened', async () => {
    const t = await taskId('Accessibility pass on navigation');
    await meera.patch(`/api/orgs/${S}/tasks/${t.id}`).send({ status: 'done' });
    expect((await ctx.ids('SELECT completed_at FROM tasks WHERE id = $1', [t.id]))[0].completed_at).not.toBeNull();
    await meera.patch(`/api/orgs/${S}/tasks/${t.id}`).send({ status: 'todo' });
    expect((await ctx.ids('SELECT completed_at FROM tasks WHERE id = $1', [t.id]))[0].completed_at).toBeNull();
  });
  it('subtasks cannot have subtasks', async () => {
    const sub = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'Plan cards'`))[0].id;
    const r = await rohan.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'deep', parentId: sub });
    expect(r.status).toBe(400);
  });
  it('validates input on the server', async () => {
    expect((await rohan.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: '' })).status).toBe(400);
    expect((await rohan.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'x', priority: 'whenever' })).status).toBe(400);
    expect((await rohan.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'x', dueAt: 'next tuesday' })).status).toBe(400);
  });
});

describe('notifications', () => {
  it('tells the assignee, not the person who assigned', async () => {
    const r = await kabir.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'Ping test', assigneeId: user.meera });
    const rows = await ctx.ids(`SELECT user_id FROM notifications WHERE task_id = $1 AND type = 'assigned'`, [r.body.task.id]);
    expect(rows.map((x) => x.user_id)).toEqual([user.meera]);
  });
  it('does not notify you about your own comment', async () => {
    const t = await taskId('Build the pricing page'); // assignee Rohan, creator Kabir
    await rohan.post(`/api/orgs/${S}/tasks/${t.id}/comments`).send({ body: 'On it' });
    const rows = await ctx.ids(`SELECT user_id FROM notifications WHERE task_id = $1 AND type = 'comment'`, [t.id]);
    const ids = rows.map((x) => x.user_id);
    expect(ids).not.toContain(user.rohan);
    expect(ids).toContain(user.kabir);
  });
  it('the overdue scan does not create duplicates when it runs again', async () => {
    const before = (await ctx.ids(`SELECT count(*)::int AS n FROM notifications WHERE type = 'overdue'`))[0].n;
    expect(before).toBeGreaterThan(0);
    await scanOverdue(ctx.db);
    await scanOverdue(ctx.db);
    const after = (await ctx.ids(`SELECT count(*)::int AS n FROM notifications WHERE type = 'overdue'`))[0].n;
    expect(after).toBe(before);
  });
  it('you can only mark your own notifications read', async () => {
    const n = (await ctx.ids('SELECT id FROM notifications WHERE user_id = $1 LIMIT 1', [user.rohan]))[0].id;
    expect((await meera.post(`/api/orgs/${S}/notifications/${n}/read`)).status).toBe(404);
    expect((await rohan.post(`/api/orgs/${S}/notifications/${n}/read`)).status).toBe(200);
  });
});

describe('attachments', () => {
  it('accepts an allowed file and lets project members download it', async () => {
    const t = await taskId('Fix contact form not sending');
    const up = await rohan.post(`/api/orgs/${S}/tasks/${t.id}/attachments`).attach('file', Buffer.from('steps to reproduce'), 'repro.txt');
    expect(up.status).toBe(201);
    const dl = await meera.get(`/api/orgs/${S}/tasks/${t.id}/attachments/${up.body.attachment.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="?repro.txt"?/);
  });
  it('rejects disallowed types, including a renamed extension', async () => {
    const t = await taskId('Fix contact form not sending');
    const exe = await rohan.post(`/api/orgs/${S}/tasks/${t.id}/attachments`).attach('file', Buffer.from('MZ'), 'tool.exe');
    expect(exe.status).toBe(415);
    const html = await rohan.post(`/api/orgs/${S}/tasks/${t.id}/attachments`).attach('file', Buffer.from('<script>'), { filename: 'page.html', contentType: 'text/html' });
    expect(html.status).toBe(415);
  });
  it('rejects files over 5 MB', async () => {
    const t = await taskId('Fix contact form not sending');
    const big = await rohan.post(`/api/orgs/${S}/tasks/${t.id}/attachments`).attach('file', Buffer.alloc(5 * 1024 * 1024 + 10), 'big.txt');
    expect(big.status).toBe(413);
  });
  it('employees outside the project cannot download it', async () => {
    const t = await taskId('Login with phone number');
    const up = await rohan.post(`/api/orgs/${S}/tasks/${t.id}/attachments`).attach('file', Buffer.from('spec'), 'spec.txt');
    expect(up.status).toBe(201);
    expect((await meera.get(`/api/orgs/${S}/tasks/${t.id}/attachments/${up.body.attachment.id}`)).status).toBe(404);
  });
});

describe('reports', () => {
  it('numbers match a direct count of the database', async () => {
    const r = (await asha.get(`/api/orgs/${S}/reports`)).body;
    const truth = (await ctx.ids(`
      SELECT count(*) FILTER (WHERE t.status <> 'done')::int AS active,
             count(*) FILTER (WHERE t.status <> 'done' AND t.assignee_id IS NOT NULL)::int AS assigned,
             count(*) FILTER (WHERE t.status <> 'done' AND t.due_at < now())::int AS overdue
      FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.org_id = $1 AND t.parent_id IS NULL AND t.archived = false AND p.status = 'active'`, [S]))[0];
    expect(r.metrics.overdueCount).toBe(truth.overdue);
    expect(r.metrics.assignmentCoverage).toEqual({ num: truth.assigned, den: truth.active, value: truth.assigned / truth.active });
    const dist = r.statusDistribution.reduce((s: number, x: any) => s + x.count, 0);
    expect(dist).toBe(r.metrics.progress.den);
    expect(r.trend).toHaveLength(8);
  });
  it('returns null (not 0% or NaN) when there is nothing to divide by', async () => {
    const r = (await asha.get(`/api/orgs/${S}/reports?from=2001-01-01T00:00:00Z&to=2001-02-01T00:00:00Z`)).body;
    expect(r.metrics.completionRate).toEqual({ num: 0, den: 0, value: null });
    expect(r.metrics.onTimeRate.value).toBeNull();
  });
  it('rejects a backwards date range', async () => {
    const r = await asha.get(`/api/orgs/${S}/reports?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z`);
    expect(r.status).toBe(400);
  });
});
