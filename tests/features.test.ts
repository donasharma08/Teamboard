/** Workspaces, milestones, weighted progress, the email channel, error logging, and the 002 migration upgrade path. */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { as, setup } from './helpers.js';
import { ROOT, createDb, migrate } from '../server/db.js';
import { deliverEmails } from '../server/lib/email.js';
import { scanOverdue } from '../server/lib/events.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let S: number, B: number;
let asha: any, kabir: any, meera: any, vikram: any;
let website: number, mobile: number;
let user: Record<string, number>;

beforeAll(async () => {
  ctx = await setup();
  S = ctx.orgs['Saffron Studio'];
  B = ctx.orgs['Banyan Logistics'];
  website = (await ctx.ids(`SELECT id FROM projects WHERE name = 'Website relaunch'`))[0].id;
  mobile = (await ctx.ids(`SELECT id FROM projects WHERE name = 'Mobile app v2'`))[0].id;
  user = Object.fromEntries((await ctx.ids('SELECT id, email FROM users')).map((r) => [r.email.split('@')[0], r.id]));
  [asha, kabir, meera, vikram] = await Promise.all(['asha@saffron.test', 'kabir@saffron.test', 'meera@saffron.test', 'vikram@banyan.test'].map((e) => as(ctx.app, e)));
});
afterAll(() => ctx.db.close());

describe('workspaces', () => {
  it('lists only your organisation’s workspaces, with project counts you are allowed to see', async () => {
    const all = (await kabir.get(`/api/orgs/${S}/workspaces`)).body.workspaces;
    expect(all.map((w: any) => w.name)).toEqual(['Client work', 'Our product']);
    const mine = (await meera.get(`/api/orgs/${S}/workspaces`)).body.workspaces;
    expect(mine.find((w: any) => w.name === 'Our product').project_count).toBe(0); // Meera is not on Mobile app v2
  });
  it('managers create workspaces and put projects in them; employees cannot', async () => {
    expect((await meera.post(`/api/orgs/${S}/workspaces`).send({ name: 'Mine' })).status).toBe(403);
    const w = await kabir.post(`/api/orgs/${S}/workspaces`).send({ name: 'Internal' });
    expect(w.status).toBe(201);
    const p = await kabir.post(`/api/orgs/${S}/projects`).send({ name: 'Office move', workspaceId: w.body.workspace.id });
    expect(p.body.project.workspace_id).toBe(w.body.workspace.id);
    const filtered = (await kabir.get(`/api/orgs/${S}/projects?workspace=${w.body.workspace.id}`)).body.projects;
    expect(filtered.map((x: any) => x.name)).toEqual(['Office move']);
  });
  it('a workspace that still has projects cannot be deleted', async () => {
    const ws = (await ctx.ids(`SELECT id FROM workspaces WHERE name = 'Client work'`))[0].id;
    expect((await asha.delete(`/api/orgs/${S}/workspaces/${ws}`)).status).toBe(409);
  });
  it('another organisation’s workspace cannot be used, renamed or deleted', async () => {
    const theirs = (await ctx.ids('SELECT id FROM workspaces WHERE org_id = $1', [B]))[0].id;
    expect((await asha.post(`/api/orgs/${S}/projects`).send({ name: 'Sneaky', workspaceId: theirs })).status).toBe(404);
    expect((await asha.patch(`/api/orgs/${S}/workspaces/${theirs}`).send({ name: 'Renamed' })).status).toBe(404);
    expect((await asha.delete(`/api/orgs/${S}/workspaces/${theirs}`)).status).toBe(404);
    expect((await vikram.get(`/api/orgs/${S}/workspaces`)).status).toBe(404);
  });
});

describe('milestones', () => {
  it('appear on the project with their own progress', async () => {
    const r = (await kabir.get(`/api/orgs/${S}/projects/${website}`)).body;
    const content = r.milestones.find((m: any) => m.name === 'Content ready');
    expect(content).toMatchObject({ total: 3, done: 3, progress: 1 });
    const launch = r.milestones.find((m: any) => m.name === 'Launch');
    expect(launch.total).toBe(4);
  });
  it('a task can only join a milestone of its own project', async () => {
    const beta = (await ctx.ids(`SELECT id FROM milestones WHERE name = 'Beta release'`))[0].id;
    const t = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'Choose analytics tool'`))[0].id;
    const r = await kabir.patch(`/api/orgs/${S}/tasks/${t}`).send({ milestoneId: beta });
    expect(r.status).toBe(400);
  });
  it('the database refuses a cross-project milestone even if the API were bypassed', async () => {
    const beta = (await ctx.ids(`SELECT id FROM milestones WHERE name = 'Beta release'`))[0].id;
    const t = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'Choose analytics tool'`))[0].id;
    await expect(ctx.db.query('UPDATE tasks SET milestone_id = $1 WHERE id = $2', [beta, t])).rejects.toMatchObject({ code: '23503' });
  });
  it('deleting a milestone keeps its tasks', async () => {
    const m = await kabir.post(`/api/orgs/${S}/projects/${mobile}/milestones`).send({ name: 'Temporary', dueAt: null });
    const t = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'App store screenshots'`))[0].id;
    expect((await kabir.patch(`/api/orgs/${S}/tasks/${t}`).send({ milestoneId: m.body.milestone.id })).status).toBe(200);
    expect((await kabir.delete(`/api/orgs/${S}/projects/${mobile}/milestones/${m.body.milestone.id}`)).status).toBe(200);
    const row = (await ctx.ids('SELECT milestone_id, archived, project_id FROM tasks WHERE id = $1', [t]))[0];
    expect(row).toEqual({ milestone_id: null, archived: false, project_id: mobile });
  });
  it('employees cannot create milestones; outsiders cannot see them', async () => {
    expect((await meera.post(`/api/orgs/${S}/projects/${website}/milestones`).send({ name: 'Mine' })).status).toBe(403);
    expect((await vikram.get(`/api/orgs/${B}/projects/${website}`)).status).toBe(404);
  });
});

describe('weighted progress', () => {
  it('weights urgent 4, high 3, medium 2, low 1 and matches a hand count', async () => {
    const r = (await kabir.get(`/api/orgs/${S}/projects/${website}`)).body;
    const tasks = await ctx.ids(`SELECT priority, status FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND archived = false`, [website]);
    const w: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    const total = tasks.reduce((s, t) => s + w[t.priority], 0);
    const done = tasks.filter((t) => t.status === 'done').reduce((s, t) => s + w[t.priority], 0);
    expect(r.stats.weightedProgress).toBeCloseTo(done / total, 6);
    const rep = (await kabir.get(`/api/orgs/${S}/reports?projectId=${website}`)).body;
    expect(rep.metrics.weightedProgress).toEqual({ num: done, den: total, value: done / total });
  });
});

describe('email channel', () => {
  it('queues email only for assignments and overdue work, never for comments', async () => {
    const before = (await ctx.ids('SELECT count(*)::int AS n FROM email_outbox'))[0].n;
    const t = await kabir.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'Email me', assigneeId: user.meera });
    await kabir.post(`/api/orgs/${S}/tasks/${t.body.task.id}/comments`).send({ body: 'hello' });
    const rows = await ctx.ids('SELECT to_email, subject FROM email_outbox ORDER BY id DESC LIMIT 5');
    const after = (await ctx.ids('SELECT count(*)::int AS n FROM email_outbox'))[0].n;
    expect(after - before).toBe(1);
    expect(rows[0]).toMatchObject({ to_email: 'meera@saffron.test' });
    expect(rows[0].subject).toContain('Email me');
  });
  it('respects the person’s email preference', async () => {
    expect((await meera.patch('/api/auth/me').send({ emailNotifications: false })).status).toBe(200);
    const before = (await ctx.ids('SELECT count(*)::int AS n FROM email_outbox'))[0].n;
    await kabir.post(`/api/orgs/${S}/projects/${website}/tasks`).send({ title: 'Quiet one', assigneeId: user.meera });
    expect((await ctx.ids('SELECT count(*)::int AS n FROM email_outbox'))[0].n).toBe(before);
    expect((await meera.get('/api/auth/me')).body.user.emailNotifications).toBe(false);
    await meera.patch('/api/auth/me').send({ emailNotifications: true });
  });
  it('the overdue scan does not queue duplicate emails', async () => {
    const before = (await ctx.ids(`SELECT count(*)::int AS n FROM email_outbox`))[0].n;
    await scanOverdue(ctx.db);
    expect((await ctx.ids(`SELECT count(*)::int AS n FROM email_outbox`))[0].n).toBe(before);
  });
  it('without SMTP_URL, emails are marked "logged" (not delivered) and reported separately', async () => {
    delete process.env.SMTP_URL;
    await deliverEmails(ctx.db);
    const statuses = await ctx.ids(`SELECT DISTINCT status FROM email_outbox`);
    expect(statuses.map((s) => s.status)).toEqual(['logged']);
    const rep = (await asha.get(`/api/orgs/${S}/reports`)).body.metrics.notifications;
    expect(rep.email.sent).toBe(0);
    expect(rep.email.logged).toBeGreaterThan(0);
    expect(rep.emailConfigured).toBe(false);
  });
});

describe('reports by workspace', () => {
  it('limits every number to the projects in that workspace', async () => {
    const product = (await ctx.ids(`SELECT id FROM workspaces WHERE name = 'Our product'`))[0].id;
    const r = (await asha.get(`/api/orgs/${S}/reports?workspaceId=${product}`)).body;
    expect(r.projects.map((p: any) => p.name)).toEqual(['Mobile app v2']);
  });
});

describe('error logging', () => {
  it('every response carries a request id', async () => {
    const r = await request(ctx.app).get('/api/health');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
  });
  it('browser errors are accepted and written to the log file', async () => {
    const r = await request(ctx.app).post('/api/client-errors').send({ message: 'boom-test-marker', page: '/o/1' });
    expect(r.status).toBe(204);
    const file = path.resolve(ROOT, process.env.LOG_DIR ?? 'storage/logs', 'app.log');
    expect(fs.readFileSync(file, 'utf8')).toContain('boom-test-marker');
  });
});

describe('migration 002 on an existing database', () => {
  it('creates a General workspace per organisation and moves existing projects into it', async () => {
    const db = await createDb({ dir: 'memory' });
    await db.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await db.exec(fs.readFileSync(path.join(ROOT, 'database/migrations/001_init.sql'), 'utf8'));
    await db.exec(`INSERT INTO schema_migrations(name) VALUES ('001_init.sql')`);
    await db.exec(`INSERT INTO organizations (name) VALUES ('Old Co'); INSERT INTO projects (org_id, name) VALUES (1, 'Legacy project');`);
    expect(await migrate(db)).toEqual(['002_workspaces_milestones_email.sql']);
    const row = (await db.query(`SELECT w.name FROM projects p JOIN workspaces w ON w.id = p.workspace_id`)).rows[0];
    expect(row.name).toBe('General');
    await db.close();
  });
});
