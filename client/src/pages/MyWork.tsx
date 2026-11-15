import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, orgApi } from '../lib/api';
import { useSession } from '../lib/session';
import { dueLabel, firstName, greeting } from '../lib/format';
import { STATUS_LABEL, type Status } from '../lib/types';
import { Empty, PriorityTag, Spinner, usePoll, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Row { id: number; title: string; status: Status; priority: string; due_at: string | null; project_id: number; project_name: string; parent_id: number | null; is_overdue: boolean }
interface Data { overdue: Row[]; upcoming: Row[]; later: Row[] }

export function MyWork() {
  const orgId = Number(useParams().orgId);
  const o = orgApi(orgId);
  const { user } = useSession();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(() => { api.get<Data>(o('/my-work')).then(setData).catch(() => {}); }, [orgId]);
  useEffect(load, [load]);
  usePoll(load, 20000);

  async function finish(t: Row) {
    // Optimistic: hide it right away, put it back if the server says no.
    setData((d) => d && { overdue: d.overdue.filter((x) => x.id !== t.id), upcoming: d.upcoming.filter((x) => x.id !== t.id), later: d.later.filter((x) => x.id !== t.id) });
    try {
      await api.patch(o(`/tasks/${t.id}`), { status: 'done' });
      toast({ tone: 'ok', text: `Nice — "${t.title}" is done.`, action: { label: 'Undo', run: async () => { await api.patch(o(`/tasks/${t.id}`), { status: t.status }); load(); } } });
    } catch (e: any) {
      toast({ tone: 'warn', text: e.message });
      load();
    }
  }

  if (!data) return <Spinner />;
  const total = data.overdue.length + data.upcoming.length + data.later.length;

  const section = (title: string, rows: Row[], note: string, tone?: string) => (
    <section className={`work-section ${tone ?? ''}`}>
      <h2>{title} <span className="count">{rows.length}</span></h2>
      {rows.length === 0 ? <p className="muted small">{note}</p> : (
        <ul className="work-list">
          {rows.map((t) => (
            <li key={t.id} className="work-row">
              <button className="check" onClick={() => finish(t)} aria-label={`Mark "${t.title}" as done`} title="Mark as done">
                <Icon name="check" size={14} />
              </button>
              <Link to={`/o/${orgId}/projects/${t.project_id}?task=${t.parent_id ?? t.id}`} className="work-main">
                <span className="work-title">{t.title}</span>
                <span className="work-meta">
                  <span>{t.project_name}</span>
                  <span aria-hidden>·</span>
                  <span>{STATUS_LABEL[t.status]}</span>
                </span>
              </Link>
              <PriorityTag p={t.priority} />
              <span className={`due ${t.is_overdue ? 'due-late' : ''}`}>
                {t.is_overdue && <Icon name="clock" size={13} />}{dueLabel(t.due_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting()}, {firstName(user?.name)}.</h1>
          <p className="lede">
            {total === 0 ? 'Your plate is clear. Enjoy it, or pick something up from a project.'
              : data.overdue.length ? `You have ${total} open ${total === 1 ? 'task' : 'tasks'}. ${data.overdue.length} ${data.overdue.length === 1 ? 'is' : 'are'} running late — maybe start there.`
              : `You have ${total} open ${total === 1 ? 'task' : 'tasks'}, and nothing is late. Good going.`}
          </p>
        </div>
      </header>
      {total === 0 ? (
        <div className="card"><Empty icon="check" title="Nothing assigned to you">Tasks people give you will show up here, sorted by when they are due.</Empty></div>
      ) : (
        <div className="work-grid">
          {section('Running late', data.overdue, 'Nothing is late. Lovely.', 'late')}
          {section('Due in the next 7 days', data.upcoming, 'Nothing due this week.')}
          {section('Later, or no date yet', data.later, 'Nothing further out.')}
        </div>
      )}
    </div>
  );
}
