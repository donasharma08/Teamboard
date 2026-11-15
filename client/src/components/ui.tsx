import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

// ---------- Avatar ----------
const AVATAR_TONES = ['moss', 'ochre', 'plum', 'clay', 'olive', 'aubergine'];
export function Avatar({ name, size = 28, title }: { name?: string | null; size?: number; title?: string }) {
  if (!name) {
    return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned" aria-label="Unassigned">?</span>;
  }
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className={`avatar tone-${AVATAR_TONES[h % AVATAR_TONES.length]}`} style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={title ?? name} aria-label={name}>
      {initials}
    </span>
  );
}

// ---------- Toasts (with optional Undo) ----------
type Toast = { id: number; text: string; tone: 'ok' | 'warn'; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.action ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} size={16} />
            <span>{t.text}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------- Small pieces ----------
export function Empty({ icon = 'sparkle', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={22} /></span>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="loading" role="status"><span className="dot" /><span className="dot" /><span className="dot" /><span className="sr-only">{label}</span></div>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function PriorityTag({ p }: { p: string }) {
  const label = p[0].toUpperCase() + p.slice(1);
  return <span className={`prio prio-${p}`} title={`${label} priority`}><Icon name="flag" size={12} />{label}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Re-runs fn every `ms` while the tab is visible. Used instead of WebSockets (documented limitation). */
export function usePoll(fn: () => void, ms: number) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && saved.current();
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [ms]);
}
