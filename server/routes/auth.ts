import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Db } from '../db.js';
import { COOKIE, checkPassword, endSession, hashPassword, requireAuth, startSession } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(80),
  email: z.string().trim().toLowerCase().email('That email does not look right'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  orgName: z.string().trim().min(2, 'Give your organisation a name').max(80),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('That email does not look right'),
  password: z.string().min(1, 'Enter your password'),
});

export function authRoutes(db: Db) {
  const r = Router();
  // Slow down password guessing: 20 attempts per 15 minutes per IP.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many attempts. Take a short break and try again in a few minutes.' },
  });

  r.post('/register', limiter, async (req, res) => {
    const body = parse(registerSchema, req.body);
    const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
    if (exists.rows[0]) throw new HttpError(409, 'An account with that email already exists. Try signing in.', { email: 'Already registered' });
    const hash = await hashPassword(body.password);
    const user = await db.tx(async (q) => {
      const u = (await q.query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [body.email, body.name, hash])).rows[0];
      const org = (await q.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [body.orgName])).rows[0];
      await q.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org.id, u.id]);
      return u;
    });
    startSession(res, user.id);
    res.status(201).json({ user });
  });

  r.post('/login', limiter, async (req, res) => {
    const body = parse(loginSchema, req.body);
    const { rows } = await db.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [body.email]);
    const u = rows[0];
    // Same message whether the email or the password is wrong, so emails cannot be probed.
    if (!u || !(await checkPassword(body.password, u.password_hash))) {
      throw new HttpError(401, 'That email and password do not match');
    }
    startSession(res, u.id);
    res.json({ user: { id: u.id, name: u.name, email: u.email } });
  });

  r.post('/logout', (_req, res) => {
    endSession(res);
    res.json({ ok: true });
  });

  // Signed-out visitors get { user: null } (not a 401) so the first page load is quiet.
  r.patch('/me', requireAuth(db), async (req, res) => {
    const body = parse(z.object({ emailNotifications: z.boolean() }), req.body);
    await db.query('UPDATE users SET email_notifications = $2 WHERE id = $1', [req.user!.id, body.emailNotifications]);
    res.json({ ok: true });
  });

  r.get('/me', (req, res, next) => (req.cookies?.[COOKIE] ? next() : res.json({ user: null, orgs: [] })), requireAuth(db), async (req, res) => {
    const { rows } = await db.query(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [req.user!.id],
    );
    const pref = (await db.query('SELECT email_notifications FROM users WHERE id = $1', [req.user!.id])).rows[0];
    res.json({ user: { ...req.user, emailNotifications: pref?.email_notifications ?? true }, orgs: rows });
  });

  return r;
}
