import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useSession } from '../lib/session';
import { Avatar, Field } from '../components/ui';

const DEMO = [
  { email: 'asha@saffron.test', name: 'Asha Rao', note: 'Owner at Saffron Studio' },
  { email: 'kabir@saffron.test', name: 'Kabir Mehta', note: 'Manager at Saffron Studio' },
  { email: 'meera@saffron.test', name: 'Meera Iyer', note: 'Employee — only her own projects' },
  { email: 'vikram@banyan.test', name: 'Vikram Shah', note: 'Owner at Banyan Logistics' },
];

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { refresh } = useSession();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent, override?: { email: string; password: string }) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg('');
    try {
      if (mode === 'signup' && !override) await api.post('/api/auth/register', form);
      else await api.post('/api/auth/login', override ?? { email: form.email, password: form.password });
      await refresh();
      nav('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setMsg(err.message);
        if (err.details) setErrors(err.details);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-intro">
        <span className="brand-mark big" aria-hidden><span /><span /><span /></span>
        <h1>TeamBoard</h1>
        <p>Your projects, tasks and conversations in one calm place, so nothing slips quietly past its deadline.</p>
        <LoginArt />
      </section>

      <section className="auth-card card">
        <h2>{mode === 'login' ? 'Welcome back' : 'Start your workspace'}</h2>
        <p className="muted">{mode === 'login' ? 'Sign in to pick up where you left off.' : 'It takes about a minute. You will be the owner.'}</p>

        <form onSubmit={submit} noValidate>
          {mode === 'signup' && (
            <>
              <Field label="Your name" error={errors.name}><input value={form.name} onChange={set('name')} autoComplete="name" required /></Field>
              <Field label="Organisation name" error={errors.orgName} hint="Your company or team. You can invite people later.">
                <input value={form.orgName} onChange={set('orgName')} required />
              </Field>
            </>
          )}
          <Field label="Email" error={errors.email}><input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></Field>
          <Field label="Password" error={errors.password} hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
            <input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </Field>
          {msg && <p className="form-error" role="alert">{msg}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create my workspace'}
          </button>
        </form>

        <p className="switch-mode">
          {mode === 'login' ? <>New here? <Link to="/signup">Create a workspace</Link></> : <>Already have an account? <Link to="/">Sign in</Link></>}
        </p>

        {mode === 'login' && (
          <div className="demo">
            <p className="demo-title">Just looking around? Try a demo person</p>
            <div className="demo-list">
              {DEMO.map((d) => (
                <button key={d.email} type="button" className="demo-person" disabled={busy}
                  onClick={(e) => submit(e, { email: d.email, password: 'password123' })}>
                  <Avatar name={d.name} size={34} />
                  <span><strong>{d.name}</strong><small>{d.note}</small></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** Decorative line drawing under the title: a stem with leaves in the four status colours. */
function LoginArt() {
  return (
    <svg className="leaf-art" viewBox="0 0 420 200" aria-hidden>
      <path d="M20 180 C 120 170, 200 120, 260 40" fill="none" stroke="#2E6B45" strokeWidth="3" strokeLinecap="round" />
      <path d="M90 168 C 70 130, 90 100, 130 92 C 140 128, 122 156, 90 168 Z" fill="#DDEDDF" stroke="#2E6B45" strokeWidth="2" />
      <path d="M160 140 C 150 96, 176 70, 214 70 C 218 108, 196 134, 160 140 Z" fill="#ECE9F7" stroke="#5E4FA2" strokeWidth="2" />
      <path d="M150 150 C 190 160, 222 186, 226 196 C 190 200, 160 182, 150 150 Z" fill="#FCE7DA" stroke="#D0672A" strokeWidth="2" />
      <path d="M228 96 C 236 60, 266 44, 300 52 C 294 84, 268 102, 228 96 Z" fill="#F4E6F1" stroke="#7C3F73" strokeWidth="2" />
      <circle cx="262" cy="38" r="9" fill="#F4A26B" />
      <circle cx="330" cy="120" r="4" fill="#BACBB6" /><circle cx="352" cy="96" r="3" fill="#BACBB6" /><circle cx="372" cy="128" r="5" fill="#BACBB6" />
    </svg>
  );
}
