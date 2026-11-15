/**
 * Structured logging. One JSON object per line on stdout (what hosts like Render collect),
 * and warnings/errors are also appended to storage/logs/app.log so they survive a terminal close.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../db.js';

type Level = 'info' | 'warn' | 'error';
const LOG_DIR = path.resolve(ROOT, process.env.LOG_DIR ?? path.join('storage', 'logs'));
const quiet = () => process.env.NODE_ENV === 'test';

export function log(level: Level, message: string, meta: Record<string, unknown> = {}) {
  const entry = { time: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(entry);
  if (!quiet()) (level === 'error' ? console.error : console.log)(line);
  if (level !== 'info') {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, 'app.log'), line + '\n');
    } catch {
      /* logging must never crash the app */
    }
  }
}

export const errorDetails = (e: unknown) =>
  e instanceof Error ? { error: e.message, stack: e.stack?.split('\n').slice(0, 6).join('\n') } : { error: String(e) };
