/**
 * The headline requirement: "prove that one organisation's users cannot access another organisation's data."
 * Vikram owns Banyan Logistics. He tries every route against Saffron Studio's data.
 * Every attempt must fail with 404 (we do not even confirm the record exists) and change nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { as, setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
let vikram: any;
let asha: any;
let S: number; // Saffron org id
let B: number; // Banyan org id
let saffronProject: number;
let saffronTask: number;
let saffronAttachment: number;
let banyanProject: number;
let banyanTask: number;
let banyanSecretTask: number;
let ashaId: number;

beforeAll(async () => {
  ctx = await setup();
  S = ctx.orgs['Saffron Studio'];
  B = ctx.orgs['Banyan Logistics'];
  [saffronProject] = (await ctx.ids(`SELECT id FROM projects WHERE name = 'Website relaunch'`)).map((r) => r.id);
  [saffronTask] = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'Build the pricing page'`)).map((r) => r.id);
  [saffronAttachment] = (await ctx.ids('SELECT id FROM attachments')).map((r) => r.id);
  [banyanProject] = (await ctx.ids(`SELECT id FROM projects WHERE org_id = $1`, [B])).map((r) => r.id);
  [banyanTask] = (await ctx.ids(`SELECT id FROM tasks WHERE title = 'Train night shift'`)).map((r) => r.id);
  [banyanSecretTask] = (await ctx.ids(`SELECT id FROM tasks WHERE title LIKE 'Confidential%'`)).map((r) => r.id);
  [ashaId] = (await ctx.ids(`SELECT id FROM users WHERE email = 'asha@saffron.test'`)).map((r) => r.id);
  vikram = await as(ctx.app, 'vikram@banyan.test');
  asha = await as(ctx.app, 'asha@saffron.test');
});
afterAll(() => ctx.db.close());

describe('an outsider using the other org id in the URL', () => {
  const routes = () => [
    ['get', `/api/orgs/${S}`],
    ['get', `/api/orgs/${S}/projects`],
    ['get', `/api/orgs/${S}/projects/${saffronProject}`],
    ['get', `/api/orgs/${S}/projects/${saffronProject}/tasks`],
    ['get', `/api/orgs/${S}/tasks/${saffronTask}`],
    ['get', `/api/orgs/${S}/members`],
    ['get', `/api/orgs/${S}/reports`],
    ['get', `/api/orgs/${S}/notifications`],
    ['get', `/api/orgs/${S}/tasks/${saffronTask}/attachments/${saffronAttachment}`],
  ] as const;

  it('gets 404 on every read', async () => {
    for (const [m, url] of routes()) {
      const r = await (vikram as any)[m](url);
      expect(r.status, `${m.toUpperCase()} ${url}`).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('pricing');
    }
  });

  it('gets 404 on every write, and nothing changes', async () => {
    const before = await ctx.ids('SELECT title, status, version FROM tasks WHERE id = $1', [saffronTask]);
    const writes = [
      vikram.patch(`/api/orgs/${S}/tasks/${saffronTask}`).send({ title: 'hacked', status: 'done' }),
      vikram.delete(`/api/orgs/${S}/tasks/${saffronTask}`),
      vikram.post(`/api/orgs/${S}/tasks/${saffronTask}/comments`).send({ body: 'hi' }),
      vikram.post(`/api/orgs/${S}/projects/${saffronProject}/tasks`).send({ title: 'planted' }),
      vikram.post(`/api/orgs/${S}/projects`).send({ name: 'planted project' }),
      vikram.post(`/api/orgs/${S}/members`).send({ email: 'vikram@banyan.test', role: 'owner' }),
      vikram.post(`/api/orgs/${S}/tasks/${saffronTask}/attachments`).attach('file', Buffer.from('x'), 'x.txt'),
    ];
    for (const r of await Promise.all(writes)) expect(r.status).toBe(404);
    expect(await ctx.ids('SELECT title, status, version FROM tasks WHERE id = $1', [saffronTask])).toEqual(before);
    expect(await ctx.ids(`SELECT 1 FROM tasks WHERE title = 'planted'`)).toHaveLength(0);
    expect(await ctx.ids(`SELECT 1 FROM comments WHERE body = 'hi'`)).toHaveLength(0);
    expect(await ctx.ids(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = (SELECT id FROM users WHERE email = 'vikram@banyan.test')`, [S])).toHaveLength(0);
  });
});

describe('an outsider using their OWN org id with the other org\'s record ids', () => {
  it('cannot reach Saffron projects, tasks or files through /orgs/Banyan/...', async () => {
    const urls = [
      `/api/orgs/${B}/projects/${saffronProject}`,
      `/api/orgs/${B}/projects/${saffronProject}/tasks`,
      `/api/orgs/${B}/projects/${saffronProject}/activity`,
      `/api/orgs/${B}/tasks/${saffronTask}`,
      `/api/orgs/${B}/tasks/${saffronTask}/attachments/${saffronAttachment}`,
      `/api/orgs/${B}/reports?projectId=${saffronProject}`,
    ];
    for (const u of urls) expect((await vikram.get(u)).status, u).toBe(404);
    expect((await vikram.patch(`/api/orgs/${B}/tasks/${saffronTask}`).send({ title: 'x' })).status).toBe(404);
  });

  it('cannot assign a Saffron person to Banyan work or add them to a Banyan project', async () => {
    const r1 = await vikram.patch(`/api/orgs/${B}/tasks/${banyanTask}`).send({ assigneeId: ashaId });
    expect(r1.status).toBe(404);
    const r2 = await vikram.post(`/api/orgs/${B}/projects/${banyanProject}/members`).send({ userId: ashaId });
    expect(r2.status).toBe(404);
    const r3 = await vikram.post(`/api/orgs/${B}/projects`).send({ name: 'Sneaky', memberIds: [ashaId] });
    expect(r3.status).toBe(404);
    expect(await ctx.ids(`SELECT 1 FROM projects WHERE name = 'Sneaky'`)).toHaveLength(0); // rolled back
  });

  it('only ever sees Banyan rows in list endpoints', async () => {
    const projects = (await vikram.get(`/api/orgs/${B}/projects`)).body.projects;
    expect(projects.map((p: any) => p.name)).toEqual(['Warehouse onboarding']);
    const members = (await vikram.get(`/api/orgs/${B}/members`)).body.members;
    expect(members.every((m: any) => m.email.endsWith('@banyan.test'))).toBe(true);
    const report = (await vikram.get(`/api/orgs/${B}/reports`)).body;
    expect(report.projects.map((p: any) => p.name)).toEqual(['Warehouse onboarding']);
  });
});

describe('and the other way round', () => {
  it("Saffron's owner cannot read Banyan's confidential task", async () => {
    expect((await asha.get(`/api/orgs/${B}/tasks/${banyanSecretTask}`)).status).toBe(404);
    expect((await asha.get(`/api/orgs/${S}/tasks/${banyanSecretTask}`)).status).toBe(404);
    const search = await asha.get(`/api/orgs/${S}/projects/${saffronProject}/tasks?q=Confidential`);
    expect(search.body.tasks).toHaveLength(0);
  });
});

describe('the database itself refuses cross-org links', () => {
  it('a task cannot point at a project in another org (composite foreign key)', async () => {
    await expect(ctx.db.query('INSERT INTO tasks (org_id, project_id, title) VALUES ($1, $2, $3)', [B, saffronProject, 'bad']))
      .rejects.toMatchObject({ code: '23503' });
  });
  it('a comment cannot point at a task in another org', async () => {
    await expect(ctx.db.query('INSERT INTO comments (org_id, task_id, body) VALUES ($1, $2, $3)', [B, saffronTask, 'bad']))
      .rejects.toMatchObject({ code: '23503' });
  });
});

describe('signed-out visitors', () => {
  it('get 401 everywhere', async () => {
    expect((await request(ctx.app).get(`/api/orgs/${S}/projects`)).status).toBe(401);
    expect((await request(ctx.app).get(`/api/orgs/${S}/tasks/${saffronTask}/attachments/${saffronAttachment}`)).status).toBe(401);
  });
});
