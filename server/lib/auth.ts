import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Db } from '../db.js';
import { HttpError } from './http.js';

export type Role = 'owner' | 'manager' | 'employee';
export interface SessionUser { id: number; name: string; email: string }

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      org?: { id: number; role: Role };
    }
  }
}

export const COOKIE = 'tb_session';
const SESSION_HOURS = 8;

let generated: string | null = null;
function secret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV !== 'production') return 'dev-only-secret-not-for-production';
  // Production without a configured secret: use a random one so we never sign with a guessable key.
  // Sessions will not survive a restart until JWT_SECRET is set.
  if (!generated) {
    generated = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] JWT_SECRET is not set; using a random secret. Everyone is signed out on restart.');
  }
  return generated;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function startSession(res: Response, userId: number) {
  const token = jwt.sign({ sub: String(userId) }, secret(), { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks CSRF
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: '/',
  });
}

export function endSession(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAuth(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return next(new HttpError(401, 'Please sign in'));
    let sub: string;
    try {
      sub = (jwt.verify(token, secret()) as { sub: string }).sub;
    } catch {
      return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
    }
    const { rows } = await db.query<SessionUser>('SELECT id, name, email FROM users WHERE id = $1', [Number(sub)]);
    if (!rows[0]) return next(new HttpError(401, 'Please sign in'));
    req.user = rows[0];
    next();
  };
}
