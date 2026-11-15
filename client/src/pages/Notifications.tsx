import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, orgApi } from '../lib/api';
import { timeAgo } from '../lib/format';
import type { Notification } from '../lib/types';
import { Empty, Spinner, usePoll, useToast } from '../components/ui';
import { useSession } from '../lib/session';
import { Icon } from '../components/Icon';

const ICON: Record<string, string> = { assigned: 'users', comment: 'comment', due_changed: 'calendar', overdue: 'clock', status: 'check' };
const WHAT: Record<string, string> = { assigned: 'Assigned to you', comment: 'New comment', due_changed: 'Date changed', overdue: 'Running late', status: 'Status update' };

export function Notifications() {
  const orgId = Number(useParams().orgId);
  const o = orgApi(orgId);
  const nav = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const { user, refresh } = useSession();
  const toast = useToast();
  async function setEmail(on: boolean) {
    try {
      await api.patch('/api/auth/me', { emailNotifications: on });
      await refresh();
      toast({ tone: 'ok', text: on ? 'We will email you about new assignments and late work.' : 'Emails turned off. You will still see everything here.' });
    } catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }

  const load = useCallback(() => { api.get<{ notifications: Notification[] }>(o('/notifications')).then((r) => setItems(r.notifications)); }, [orgId]);
  useEffect(load, [load]);
  usePoll(load, 15000);
  const ping = () => window.dispatchEvent(new Event('tb:notifications-changed'));

  async function openOne(n: Notification) {
    if (!n.read_at) await api.post(o(`/notifications/${n.id}/read`)).catch(() => {});
    ping();
    if (n.project_id && n.task_id) nav(`/o/${orgId}/projects/${n.project_id}?task=${n.task_id}`);
    else load();
  }
  async function readAll() {
    await api.post(o('/notifications/read-all'));
    ping();
    load();
  }

  if (!items) return <Spinner />;
  const unread = items.filter((n) => !n.read_at).length;
  const shown = onlyUnread ? items.filter((n) => !n.read_at) : items;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="lede">{unread ? `${unread} new since you last looked.` : 'You are all caught up.'} We only tell you about things that involve you.</p>
        </div>
        <div className="head-actions">
          <label className="toggle"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Only unread</label>
          {unread > 0 && <button className="btn" onClick={readAll}><Icon name="check" /> Mark all as read</button>}
        </div>
      </header>
      <label className="email-pref card">
        <input type="checkbox" checked={user?.emailNotifications !== false} onChange={(e) => setEmail(e.target.checked)} />
        <span>
          <strong>Also email me</strong>
          <small>Only for new assignments and work that is running late. Comments and status changes stay here.</small>
        </span>
      </label>
      {shown.length === 0 ? (
        <div className="card"><Empty icon="bell" title={onlyUnread ? 'Nothing unread' : 'No notifications yet'}>When someone assigns you work, comments on your tasks, or a deadline slips, you will hear about it here.</Empty></div>
      ) : (
        <ul className="notif-list card">
          {shown.map((n) => (
            <li key={n.id}>
              <button className={`notif ${n.read_at ? '' : 'unread'} notif-${n.type}`} onClick={() => openOne(n)}>
                <span className="notif-icon"><Icon name={ICON[n.type] ?? 'bell'} size={16} /></span>
                <span className="grow">
                  <span className="notif-kind">{WHAT[n.type] ?? 'Update'}</span>
                  <span className="notif-msg">{n.message}</span>
                </span>
                <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                {!n.read_at && <span className="unread-dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
