import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT, type Db } from '../db.js';
import { HttpError, forbidden, idParam, notFound, parse } from '../lib/http.js';
import { getTask, seesAllProjects } from '../lib/scope.js';
import { logActivity, notify } from '../lib/events.js';
import { STATUS_LABEL, TASK_CARD, TASK_FROM } from '../lib/taskSql.js';
import { PRIORITIES, STATUSES, assertAssignable, assertLabels, assertMilestone } from './projects.js';

export const UPLOAD_DIR = path.resolve(ROOT, process.env.UPLOAD_DIR ?? path.join('storage', 'uploads'));
const MAX_BYTES = 5 * 1024 * 1024;
/** Only these types are accepted. Files are always downloaded, never rendered inline. */
const ALLOWED: Record<string, string[]> = {
  'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/gif': ['.gif'], 'image/webp': ['.webp'],
  'application/pdf': ['.pdf'], 'text/plain': ['.txt', '.log', '.md'], 'text/csv': ['.csv'],
  'application/zip': ['.zip'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
};

const patchSchema = z.object({
  title: z.string().trim().min(1, 'A task needs a title').max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.number().int().nullable().optional(),
  dueAt: z.string().datetime({ offset: true, message: 'Pick a valid date' }).nullable().optional(),
  position: z.number().finite().optional(),
  labelIds: z.array(z.number().int()).optional(),
  milestoneId: z.number().int().nullable().optional(),
  /** Optimistic concurrency: send the version you loaded; a mismatch means someone else edited it first. */
  version: z.number().int().optional(),
});

/** Mounted at /api/orgs/:orgId/tasks */
export function taskRoutes(db: Db) {
  const r = Router({ mergeParams: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      // Random server-side name: the user's filename never touches the filesystem path.
      filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
    }),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED[file.mimetype]?.includes(ext)) return cb(null, true);
      cb(new HttpError(415, 'That file type is not allowed. Try an image, PDF, text, CSV, Office document or zip.'));
    },
  });

  r.get('/:taskId', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    const [card, subtasks, comments, attachments, activity, parent] = await Promise.all([
      db.query(`SELECT ${TASK_CARD} ${TASK_FROM} WHERE t.id = $1`, [t.id]),
      db.query(`SELECT ${TASK_CARD} ${TASK_FROM} WHERE t.parent_id = $1 AND t.archived = false ORDER BY t.position, t.id`, [t.id]),
      db.query(
        `SELECT c.id, c.body, c.created_at, c.author_id, u.name AS author_name FROM comments c
         LEFT JOIN users u ON u.id = c.author_id WHERE c.task_id = $1 AND c.org_id = $2 ORDER BY c.created_at`, [t.id, req.org!.id]),
      db.query(
        `SELECT a.id, a.original_name, a.mime_type, a.size_bytes, a.created_at, a.uploader_id, u.name AS uploader_name
         FROM attachments a LEFT JOIN users u ON u.id = a.uploader_id WHERE a.task_id = $1 AND a.org_id = $2 ORDER BY a.created_at`, [t.id, req.org!.id]),
      db.query(
        `SELECT a.id, a.type, a.data, a.created_at, u.name AS actor_name FROM activity_events a
         LEFT JOIN users u ON u.id = a.actor_id WHERE a.task_id = $1 AND a.org_id = $2 ORDER BY a.created_at DESC, a.id DESC LIMIT 50`, [t.id, req.org!.id]),
      t.parent_id ? db.query('SELECT id, title FROM tasks WHERE id = $1', [t.parent_id]) : Promise.resolve({ rows: [] }),
    ]);
    res.json({
      task: card.rows[0], parent: parent.rows[0] ?? null, subtasks: subtasks.rows,
      comments: comments.rows, attachments: attachments.rows, activity: activity.rows,
    });
  });

  r.patch('/:taskId', async (req, res) => {
    const taskId = idParam(req.params.taskId);
    const body = parse(patchSchema, req.body);
    const result = await db.tx(async (q) => {
      const t = await getTask(q, req, taskId);
      if (body.version !== undefined && body.version !== t.version) {
        const current = (await q.query(`SELECT ${TASK_CARD} ${TASK_FROM} WHERE t.id = $1`, [t.id])).rows[0];
        throw new HttpError(409, 'Someone else changed this task a moment ago. We have loaded their version.', { current });
      }
      if (body.assigneeId !== undefined) await assertAssignable(q, req.org!.id, t.project_id, body.assigneeId);
      if (body.labelIds) await assertLabels(q, t.project_id, body.labelIds);
      if (body.milestoneId !== undefined) await assertMilestone(q, t.project_id, body.milestoneId);

      const set: string[] = [];
      const params: unknown[] = [t.id];
      const put = (col: string, v: unknown) => { params.push(v); set.push(`${col} = $${params.length}`); };
      if (body.title !== undefined) put('title', body.title);
      if (body.description !== undefined) put('description', body.description);
      if (body.priority !== undefined) put('priority', body.priority);
      if (body.assigneeId !== undefined) put('assignee_id', body.assigneeId);
      if (body.dueAt !== undefined) put('due_at', body.dueAt);
      if (body.position !== undefined) put('position', body.position);
      if (body.milestoneId !== undefined) put('milestone_id', body.milestoneId);
      if (body.status !== undefined) {
        put('status', body.status);
        if (body.status === 'done' && t.status !== 'done') set.push('completed_at = now()');
        if (body.status !== 'done') set.push('completed_at = NULL');
      }
      set.push('version = version + 1', 'updated_at = now()');
      await q.query(`UPDATE tasks SET ${set.join(', ')} WHERE id = $1`, params);

      if (body.labelIds) {
        await q.query('DELETE FROM task_labels WHERE task_id = $1', [t.id]);
        for (const lid of new Set(body.labelIds)) await q.query('INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)', [t.id, lid]);
      }

      // ---- activity + notifications, only for real changes ----
      const base = { orgId: req.org!.id, projectId: t.project_id, taskId: t.parent_id ?? t.id, actorId: req.user!.id };
      const who = req.user!.name;
      if (body.status !== undefined && body.status !== t.status) {
        await logActivity(q, { ...base, type: 'task.status', data: { title: t.title, from: t.status, to: body.status } });
        await notify(q, { orgId: req.org!.id, actorId: req.user!.id, recipients: [t.created_by, t.assignee_id], type: 'status',
          taskId: t.id, projectId: t.project_id, message: `${who} moved "${t.title}" to ${STATUS_LABEL[body.status]}` });
      }
      if (body.assigneeId !== undefined && body.assigneeId !== t.assignee_id) {
        const name = body.assigneeId ? (await q.query('SELECT name FROM users WHERE id = $1', [body.assigneeId])).rows[0]?.name : null;
        await logActivity(q, { ...base, type: 'task.assigned', data: { title: t.title, to: name } });
        await notify(q, { orgId: req.org!.id, actorId: req.user!.id, recipients: [body.assigneeId], type: 'assigned',
          taskId: t.id, projectId: t.project_id, message: `${who} assigned you "${t.title}"` });
      }
      const oldDue = t.due_at ? new Date(t.due_at).toISOString() : null;
      const newDue = body.dueAt === undefined ? oldDue : body.dueAt ? new Date(body.dueAt).toISOString() : null;
      if (newDue !== oldDue) {
        await logActivity(q, { ...base, type: 'task.due', data: { title: t.title, from: oldDue, to: newDue } });
        await notify(q, { orgId: req.org!.id, actorId: req.user!.id, recipients: [body.assigneeId ?? t.assignee_id], type: 'due_changed',
          taskId: t.id, projectId: t.project_id,
          message: newDue ? `${who} changed the due date of "${t.title}"` : `${who} removed the due date from "${t.title}"` });
      }
      if (body.title !== undefined && body.title !== t.title) {
        await logActivity(q, { ...base, type: 'task.renamed', data: { from: t.title, to: body.title } });
      }
      if (body.milestoneId !== undefined && body.milestoneId !== t.milestone_id) {
        const ms = body.milestoneId ? (await q.query('SELECT name FROM milestones WHERE id = $1', [body.milestoneId])).rows[0]?.name : null;
        await logActivity(q, { ...base, type: 'task.milestone', data: { title: t.title, to: ms } });
      }
      if (body.priority !== undefined && body.priority !== t.priority) {
        await logActivity(q, { ...base, type: 'task.priority', data: { title: t.title, from: t.priority, to: body.priority } });
      }
      return (await q.query(`SELECT ${TASK_CARD} ${TASK_FROM} WHERE t.id = $1`, [t.id])).rows[0];
    });
    res.json({ task: result });
  });

  /** Archive (soft delete). Managers/owners can archive anything; employees only tasks they created. */
  r.delete('/:taskId', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    if (!seesAllProjects(req.org!.role) && t.created_by !== req.user!.id) {
      throw forbidden('Only the person who created this task, or a manager, can remove it');
    }
    await db.tx(async (q) => {
      await q.query('UPDATE tasks SET archived = true, version = version + 1, updated_at = now() WHERE id = $1 OR parent_id = $1', [t.id]);
      await logActivity(q, { orgId: req.org!.id, projectId: t.project_id, taskId: t.parent_id ?? t.id, actorId: req.user!.id, type: 'task.archived', data: { title: t.title } });
    });
    res.json({ ok: true });
  });

  r.post('/:taskId/restore', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    if (!seesAllProjects(req.org!.role) && t.created_by !== req.user!.id) {
      throw forbidden('Only the person who created this task, or a manager, can restore it');
    }
    await db.query('UPDATE tasks SET archived = false, version = version + 1, updated_at = now() WHERE (id = $1 OR parent_id = $1) AND org_id = $2',
      [t.id, req.org!.id]);
    await logActivity(db, { orgId: req.org!.id, projectId: t.project_id, taskId: t.parent_id ?? t.id, actorId: req.user!.id, type: 'task.restored', data: { title: t.title } });
    res.json({ ok: true });
  });

  // ---------- Comments ----------
  r.post('/:taskId/comments', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    const { body } = parse(z.object({ body: z.string().trim().min(1, 'Write something first').max(4000) }), req.body);
    const comment = await db.tx(async (q) => {
      const c = (await q.query('INSERT INTO comments (org_id, task_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id, body, created_at, author_id',
        [req.org!.id, t.id, req.user!.id, body])).rows[0];
      await logActivity(q, { orgId: req.org!.id, projectId: t.project_id, taskId: t.parent_id ?? t.id, actorId: req.user!.id, type: 'comment.added', data: { title: t.title } });
      // Notify the assignee, the creator, and anyone who already commented — but not the author.
      const earlier = await q.query('SELECT DISTINCT author_id FROM comments WHERE task_id = $1', [t.id]);
      await notify(q, {
        orgId: req.org!.id, actorId: req.user!.id, type: 'comment', taskId: t.id, projectId: t.project_id,
        recipients: [t.assignee_id, t.created_by, ...earlier.rows.map((x) => x.author_id)],
        message: `${req.user!.name} commented on "${t.title}"`,
      });
      return { ...c, author_name: req.user!.name };
    });
    res.status(201).json({ comment });
  });

  r.delete('/:taskId/comments/:commentId', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    const c = (await db.query('SELECT author_id FROM comments WHERE id = $1 AND task_id = $2 AND org_id = $3',
      [idParam(req.params.commentId), t.id, req.org!.id])).rows[0];
    if (!c) throw notFound('Comment not found');
    if (c.author_id !== req.user!.id && !seesAllProjects(req.org!.role)) throw forbidden('You can only delete your own comments');
    await db.query('DELETE FROM comments WHERE id = $1', [idParam(req.params.commentId)]);
    res.json({ ok: true });
  });

  // ---------- Attachments ----------
  r.post('/:taskId/attachments', async (req, res, next) => {
    // Check access BEFORE accepting bytes, so outsiders cannot even write to disk.
    const t = await getTask(db, req, idParam(req.params.taskId));
    upload.single('file')(req, res, async (err: unknown) => {
      try {
        if (err) throw err;
        const f = req.file;
        if (!f) throw new HttpError(400, 'Choose a file to upload');
        const a = (await db.query(
          `INSERT INTO attachments (org_id, task_id, uploader_id, original_name, stored_name, mime_type, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, original_name, mime_type, size_bytes, created_at, uploader_id`,
          [req.org!.id, t.id, req.user!.id, f.originalname.slice(0, 200), f.filename, f.mimetype, f.size],
        )).rows[0];
        await logActivity(db, { orgId: req.org!.id, projectId: t.project_id, taskId: t.parent_id ?? t.id, actorId: req.user!.id,
          type: 'attachment.added', data: { title: t.title, file: a.original_name } });
        res.status(201).json({ attachment: { ...a, uploader_name: req.user!.name } });
      } catch (e) {
        if (req.file) fs.rm(req.file.path, { force: true }, () => {});
        next(e);
      }
    });
  });

  r.get('/:taskId/attachments/:attachmentId', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    const a = (await db.query('SELECT * FROM attachments WHERE id = $1 AND task_id = $2 AND org_id = $3',
      [idParam(req.params.attachmentId), t.id, req.org!.id])).rows[0];
    if (!a) throw notFound('File not found');
    const file = path.join(UPLOAD_DIR, path.basename(a.stored_name));
    if (!fs.existsSync(file)) throw notFound('That file is missing from storage');
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(file, a.original_name, { dotfiles: 'allow' });
  });

  r.delete('/:taskId/attachments/:attachmentId', async (req, res) => {
    const t = await getTask(db, req, idParam(req.params.taskId));
    const a = (await db.query('SELECT * FROM attachments WHERE id = $1 AND task_id = $2 AND org_id = $3',
      [idParam(req.params.attachmentId), t.id, req.org!.id])).rows[0];
    if (!a) throw notFound('File not found');
    if (a.uploader_id !== req.user!.id && !seesAllProjects(req.org!.role)) throw forbidden('You can only remove files you uploaded');
    await db.query('DELETE FROM attachments WHERE id = $1', [a.id]);
    fs.rm(path.join(UPLOAD_DIR, path.basename(a.stored_name)), { force: true }, () => {});
    res.json({ ok: true });
  });

  return r;
}
