/**
 * Synthetic demo data — two organisations so tenant isolation can be shown live.
 * Every date is relative to "now", so the demo always has overdue, upcoming and finished work.
 * All people, companies and emails here are made up (.test is a reserved domain).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db, Queryable } from '../../server/db.js';
import { hashPassword } from '../../server/lib/auth.js';
import { scanOverdue } from '../../server/lib/events.js';
import { UPLOAD_DIR } from '../../server/routes/tasks.js';

export const DEMO_PASSWORD = 'password123';

const day = 864e5;
const at = (days: number, hour = 17) => {
  const d = new Date(Date.now() + days * day);
  d.setUTCHours(hour, 30, 0, 0);
  return d.toISOString();
};

type T = {
  title: string; status?: string; priority?: string; who?: string; due?: number; created?: number; done?: number;
  desc?: string; labels?: string[]; ms?: string; subs?: { title: string; done?: boolean; who?: string }[];
  comments?: [string, string][];
};

export async function seed(db: Db) {
  const pw = await hashPassword(DEMO_PASSWORD);
  await db.tx(async (q) => {
    const users: Record<string, number> = {};
    const people: [string, string, string][] = [
      ['asha', 'Asha Rao', 'asha@saffron.test'], ['kabir', 'Kabir Mehta', 'kabir@saffron.test'],
      ['meera', 'Meera Iyer', 'meera@saffron.test'], ['rohan', 'Rohan Das', 'rohan@saffron.test'],
      ['vikram', 'Vikram Shah', 'vikram@banyan.test'], ['neha', 'Neha Kulkarni', 'neha@banyan.test'],
    ];
    for (const [key, name, email] of people) {
      users[key] = (await q.query('INSERT INTO users (name, email, password_hash, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, email, pw, at(-60)])).rows[0].id;
    }

    const saffron = (await q.query(`INSERT INTO organizations (name, created_at) VALUES ('Saffron Studio', $1) RETURNING id`, [at(-60)])).rows[0].id;
    const banyan = (await q.query(`INSERT INTO organizations (name, created_at) VALUES ('Banyan Logistics', $1) RETURNING id`, [at(-60)])).rows[0].id;
    const member = (org: number, u: string, role: string) =>
      q.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3)', [org, users[u], role]);
    await member(saffron, 'asha', 'owner');
    await member(saffron, 'kabir', 'manager');
    await member(saffron, 'meera', 'employee');
    await member(saffron, 'rohan', 'employee');
    await member(banyan, 'vikram', 'owner');
    await member(banyan, 'neha', 'employee');

    const team = async (org: number, name: string, who: string[]) => {
      const id = (await q.query('INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id', [org, name])).rows[0].id;
      for (const w of who) await q.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [id, users[w]]);
      return id;
    };
    const design = await team(saffron, 'Design', ['asha', 'meera']);
    const eng = await team(saffron, 'Engineering', ['kabir', 'rohan']);
    const ops = await team(banyan, 'Operations', ['vikram', 'neha']);

    const workspace = async (org: number, name: string, description: string) =>
      (await q.query('INSERT INTO workspaces (org_id, name, description) VALUES ($1, $2, $3) RETURNING id', [org, name, description])).rows[0].id as number;
    const clientWork = await workspace(saffron, 'Client work', 'Projects we deliver for clients');
    const product = await workspace(saffron, 'Our product', 'The booking app we build and sell');
    const warehouse = await workspace(banyan, 'Warehouses', 'Rolling out tracking site by site');

    await makeProject(q, users, saffron, clientWork, design, 'Website relaunch', 'New marketing site for spring. Copy, visuals and a faster build.',
      ['asha', 'kabir', 'meera', 'rohan'], 'kabir', [['Content ready', -10], ['Launch', 12]], [
        { ms: 'Content ready', title: 'Write homepage copy', status: 'done', priority: 'high', who: 'meera', due: -20, created: -40, done: -22, labels: ['Feature'],
          comments: [['kabir', 'Lovely tone. Can we shorten the second paragraph?'], ['meera', 'Done — trimmed to two sentences.']] },
        { ms: 'Content ready', title: 'Pick a colour palette', status: 'done', priority: 'medium', who: 'asha', due: -25, created: -38, done: -24 },
        { ms: 'Content ready', title: 'Photograph the team', status: 'done', priority: 'low', who: 'meera', due: -15, created: -35, done: -12 },
        { ms: 'Launch', title: 'Build the pricing page', status: 'in_progress', priority: 'high', who: 'rohan', due: -2, created: -14, labels: ['Feature'],
          desc: 'Three plans side by side. Monthly / yearly toggle. Needs to work on small phones.',
          subs: [{ title: 'Plan cards', done: true, who: 'rohan' }, { title: 'Yearly toggle', who: 'rohan' }, { title: 'Mobile layout check' }],
          comments: [['asha', 'Can we highlight the middle plan?']] },
        { ms: 'Launch', title: 'Fix contact form not sending', status: 'review', priority: 'urgent', who: 'rohan', due: -1, created: -6, labels: ['Bug'] },
        { title: 'Accessibility pass on navigation', status: 'todo', priority: 'medium', who: 'meera', due: 3, created: -5, labels: ['Research'] },
        { ms: 'Launch', title: 'Set up redirects from old URLs', status: 'todo', priority: 'medium', who: 'kabir', due: 6, created: -3 },
        { title: 'Choose analytics tool', status: 'todo', priority: 'low', created: -2, labels: ['Research'] },
        { ms: 'Launch', title: 'Launch checklist', status: 'todo', priority: 'high', who: 'kabir', due: 12, created: -1,
          subs: [{ title: 'Final copy review' }, { title: 'Performance test' }, { title: 'Announce to clients' }] },
        { title: 'Footer links audit', status: 'done', priority: 'low', who: 'rohan', due: -9, created: -18, done: -7 },
      ]);

    await makeProject(q, users, saffron, product, eng, 'Mobile app v2', 'Rebuild of the booking app. Employees outside this project cannot see it.',
      ['asha', 'kabir', 'rohan'], 'kabir', [['Beta release', 14]], [
        { title: 'Offline mode research', status: 'done', priority: 'medium', who: 'rohan', due: -30, created: -45, done: -31, labels: ['Research'] },
        { ms: 'Beta release', title: 'Login with phone number', status: 'in_progress', priority: 'high', who: 'rohan', due: 4, created: -10, labels: ['Feature'] },
        { ms: 'Beta release', title: 'Crash on Android 12 when rotating', status: 'todo', priority: 'urgent', who: 'kabir', due: -3, created: -8, labels: ['Bug'] },
        { title: 'App store screenshots', status: 'todo', priority: 'low', who: 'asha', due: 20, created: -4 },
        { ms: 'Beta release', title: 'Push notification settings', status: 'review', priority: 'medium', who: 'rohan', due: 2, created: -12 },
      ]);

    await makeProject(q, users, banyan, warehouse, ops, 'Warehouse onboarding', 'Bring the Pune warehouse onto the new tracking flow.',
      ['vikram', 'neha'], 'vikram', [['Pune site live', 10]], [
        { ms: 'Pune site live', title: 'Label every rack with QR codes', status: 'in_progress', priority: 'high', who: 'neha', due: 5, created: -9 },
        { ms: 'Pune site live', title: 'Train night shift', status: 'todo', priority: 'medium', who: 'neha', due: -1, created: -7 },
        { ms: 'Pune site live', title: 'Order handheld scanners', status: 'done', priority: 'urgent', who: 'vikram', due: -10, created: -20, done: -11 },
        { title: 'Confidential: vendor contract terms', status: 'todo', priority: 'high', who: 'vikram', due: 9, created: -2,
          desc: 'This belongs to Banyan. No one at Saffron should ever be able to read it.' },
      ]);
  });
  await scanOverdue(db);
}

async function makeProject(
  q: Queryable, users: Record<string, number>, org: number, workspaceId: number, teamId: number, name: string, description: string,
  memberKeys: string[], creator: string, milestones: [string, number][], tasks: T[],
) {
  const p = (await q.query(
    'INSERT INTO projects (org_id, workspace_id, team_id, name, description, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
    [org, workspaceId, teamId, name, description, users[creator], at(-50)])).rows[0].id;
  const ms: Record<string, number> = {};
  for (const [mName, due] of milestones) {
    ms[mName] = (await q.query('INSERT INTO milestones (org_id, project_id, name, due_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [org, p, mName, at(due)])).rows[0].id;
  }
  for (const m of memberKeys) await q.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [p, users[m]]);
  const labels: Record<string, number> = {};
  for (const [n, c] of [['Bug', 'clay'], ['Feature', 'moss'], ['Research', 'plum']]) {
    labels[n] = (await q.query('INSERT INTO labels (org_id, project_id, name, color) VALUES ($1, $2, $3, $4) RETURNING id', [org, p, n, c])).rows[0].id;
  }
  await q.query(`INSERT INTO activity_events (org_id, project_id, actor_id, type, data, created_at) VALUES ($1, $2, $3, 'project.created', $4::jsonb, $5)`,
    [org, p, users[creator], JSON.stringify({ name }), at(-50)]);

  let pos = 0;
  for (const t of tasks) {
    pos += 1024;
    const status = t.status ?? 'todo';
    const id = (await q.query(
      `INSERT INTO tasks (org_id, project_id, title, description, status, priority, assignee_id, due_at, position,
         created_by, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12) RETURNING id`,
      [org, p, t.title, t.desc ?? '', status, t.priority ?? 'medium', t.who ? users[t.who] : null,
       t.due !== undefined ? at(t.due) : null, pos, users[creator], at(t.created ?? -3, 9),
       status === 'done' ? at(t.done ?? -1, 15) : null],
    )).rows[0].id;
    for (const l of t.labels ?? []) await q.query('INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)', [id, labels[l]]);
    if (t.ms) await q.query('UPDATE tasks SET milestone_id = $2 WHERE id = $1', [id, ms[t.ms]]);
    await q.query(`INSERT INTO activity_events (org_id, project_id, task_id, actor_id, type, data, created_at) VALUES ($1, $2, $3, $4, 'task.created', $5::jsonb, $6)`,
      [org, p, id, users[creator], JSON.stringify({ title: t.title }), at(t.created ?? -3, 9)]);
    if (status === 'done') {
      await q.query(`INSERT INTO activity_events (org_id, project_id, task_id, actor_id, type, data, created_at) VALUES ($1, $2, $3, $4, 'task.status', $5::jsonb, $6)`,
        [org, p, id, t.who ? users[t.who] : users[creator], JSON.stringify({ title: t.title, from: 'review', to: 'done' }), at(t.done ?? -1, 15)]);
    }
    let sp = 0;
    for (const s of t.subs ?? []) {
      sp += 1024;
      await q.query(
        `INSERT INTO tasks (org_id, project_id, parent_id, title, status, assignee_id, position, created_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [org, p, id, s.title, s.done ? 'done' : 'todo', s.who ? users[s.who] : null, sp, users[creator], s.done ? at(-1) : null]);
    }
    let ch = 0;
    for (const [who, body] of t.comments ?? []) {
      ch += 2;
      await q.query('INSERT INTO comments (org_id, task_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)',
        [org, id, users[who], body, new Date(Date.now() - (10 - ch) * 3600e3).toISOString()]);
    }
    if (t.who && t.who !== creator) {
      await q.query(`INSERT INTO notifications (org_id, user_id, type, task_id, project_id, message, created_at, read_at)
        VALUES ($1, $2, 'assigned', $3, $4, $5, $6, CASE WHEN $7 THEN now() END)`,
        [org, users[t.who], id, p, `Someone assigned you "${t.title}"`.replace('Someone', creatorName(creator)), at(t.created ?? -3, 9), status === 'done']);
    }
    if (t.title === 'Build the pricing page') {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const stored = crypto.randomBytes(16).toString('hex');
      const text = 'Pricing brief\n\nStarter — for one person\nStudio — most popular, highlight this one\nAgency — unlimited seats\n';
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), text);
      await q.query(`INSERT INTO attachments (org_id, task_id, uploader_id, original_name, stored_name, mime_type, size_bytes)
        VALUES ($1, $2, $3, 'pricing-brief.txt', $4, 'text/plain', $5)`, [org, id, users.asha, stored, Buffer.byteLength(text)]);
    }
  }
  return p;
}

const creatorName = (k: string) => ({ kabir: 'Kabir Mehta', vikram: 'Vikram Shah', asha: 'Asha Rao' } as Record<string, string>)[k] ?? 'A teammate';

export async function isEmpty(db: Db) {
  return (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n === 0;
}
