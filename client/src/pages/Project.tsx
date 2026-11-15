import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, orgApi } from '../lib/api';
import { describe } from '../lib/activity';
import { dueLabel, fromDateInput, pct, timeAgo } from '../lib/format';
import { useOrg, useSession } from '../lib/session';
import { PRIORITIES, type ActivityItem, type Label, type Member, type Milestone, type Project } from '../lib/types';
import { Board, type Filters } from '../components/Board';
import { TaskDrawer } from '../components/TaskDrawer';
import { Avatar, Empty, ProgressBar, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Detail {
  project: Project; members: Member[]; labels: Label[]; milestones: Milestone[]; workspace: { id: number; name: string };
  stats: { total: number; done: number; overdue: number; progress: number; weightedProgress: number }; canManage: boolean;
}

export function ProjectPage() {
  const params = useParams();
  const orgId = Number(params.orgId);
  const projectId = Number(params.projectId);
  const o = orgApi(orgId);
  const { isManager } = useOrg(orgId);
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const [d, setD] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<'overview' | 'board' | 'people' | 'activity'>('board');
  const [filters, setFilters] = useState<Filters>({ q: '', assignee: '', priority: '', label: '', milestone: '', overdue: false });
  const [q, setQ] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const openTask = search.get('task') ? Number(search.get('task')) : null;

  const load = useCallback(() => {
    api.get<Detail>(o(`/projects/${projectId}`)).then((r) => { setD(r); setNotFound(false); }).catch((e) => e.status === 404 && setNotFound(true));
  }, [orgId, projectId]);
  useEffect(load, [load]);

  // Debounce the search box so we do not query on every keystroke.
  useEffect(() => { const id = setTimeout(() => setFilters((f) => ({ ...f, q })), 250); return () => clearTimeout(id); }, [q]);

  const open = (id: number) => setSearch((s) => { s.set('task', String(id)); return s; });
  const close = useCallback(() => setSearch((s) => { s.delete('task'); return s; }), [setSearch]);
  const changed = () => { load(); setRefreshKey((k) => k + 1); };

  if (notFound) {
    return (
      <div className="page"><div className="card">
        <Empty icon="lock" title="We could not find that project">
          <p>It may have been removed, or you have not been added to it yet.</p>
          <Link className="btn" to={`/o/${orgId}/projects`}>Back to projects</Link>
        </Empty>
      </div></div>
    );
  }
  if (!d) return <Spinner />;
  const p = d.project;
  const anyFilter = !!(filters.q || filters.assignee || filters.priority || filters.label || filters.milestone || filters.overdue);

  async function setArchived(archived: boolean) {
    try {
      await api.patch(o(`/projects/${projectId}`), { status: archived ? 'archived' : 'active' });
      toast({ tone: 'ok', text: archived ? 'Project archived. It is hidden from the list but nothing is deleted.' : 'Welcome back, project.' });
      load();
    } catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }

  return (
    <div className="page page-wide">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to={`/o/${orgId}/projects`}>Projects</Link><span aria-hidden>/</span><span>{d.workspace?.name}</span><span aria-hidden>/</span><span>{p.name}</span></nav>
      <header className="page-head project-head">
        <div className="grow">
          <h1>{p.name} {p.status === 'archived' && <span className="pill">Archived</span>}</h1>
          {p.description && <p className="lede">{p.description}</p>}
          <div className="project-progress">
            <ProgressBar value={d.stats.progress} label="Project progress" />
            <span><strong>{pct(d.stats.progress)}</strong> done · {d.stats.done} of {d.stats.total} tasks</span>
            {d.stats.overdue > 0 && <span className="due-late"><Icon name="clock" size={13} /> {d.stats.overdue} running late</span>}
          </div>
        </div>
        <div className="head-actions">
          <div className="avatar-stack" aria-label={`${d.members.length} people on this project`}>
            {d.members.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} size={30} />)}
            {d.members.length > 5 && <span className="avatar more">+{d.members.length - 5}</span>}
          </div>
          {d.canManage && (p.status === 'active'
            ? <button className="btn" onClick={() => setArchived(true)}>Archive</button>
            : <button className="btn btn-primary" onClick={() => setArchived(false)}>Restore project</button>)}
        </div>
      </header>

      <div className="tabs" role="tablist">
        {(['overview', 'board', 'people', 'activity'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'board' ? 'Board' : t === 'people' ? `People (${d.members.length})` : 'Activity'}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <>
          <div className="filters" role="search">
            <label className="search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
            </label>
            <select value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })} aria-label="Filter by person">
              <option value="">Anyone</option>
              <option value="me">Just me</option>
              <option value="none">Nobody yet</option>
              {d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Filter by priority">
              <option value="">Any priority</option>
              {PRIORITIES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            {d.milestones.length > 0 && (
              <select value={filters.milestone} onChange={(e) => setFilters({ ...filters, milestone: e.target.value })} aria-label="Filter by milestone">
                <option value="">Any milestone</option>
                {d.milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                <option value="none">No milestone</option>
              </select>
            )}
            <select value={filters.label} onChange={(e) => setFilters({ ...filters, label: e.target.value })} aria-label="Filter by label">
              <option value="">Any label</option>
              {d.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <label className="toggle"><input type="checkbox" checked={filters.overdue} onChange={(e) => setFilters({ ...filters, overdue: e.target.checked })} /> Only late</label>
            {anyFilter && <button className="link-btn" onClick={() => { setQ(''); setFilters({ q: '', assignee: '', priority: '', label: '', milestone: '', overdue: false }); }}>Clear filters</button>}
            <span className="spacer" />
            <span className="muted small kbd-hint">Tip: focus a card, press <kbd>Space</kbd> to lift it, arrows to move, <kbd>Space</kbd> to drop.</span>
          </div>
          <Board orgId={orgId} projectId={projectId} members={d.members} labels={d.labels} filters={filters}
            onOpen={open} refreshKey={refreshKey} onChanged={load} />
        </>
      )}

      {tab === 'overview' && (
        <ProjectOverview orgId={orgId} projectId={projectId} d={d} reload={changed}
          showMilestone={(id) => { setFilters({ q: '', assignee: '', priority: '', label: '', milestone: String(id), overdue: false }); setQ(''); setTab('board'); }} />
      )}
      {tab === 'people' && <ProjectPeople orgId={orgId} projectId={projectId} members={d.members} canManage={d.canManage} reload={load} />}
      {tab === 'activity' && <ProjectActivity orgId={orgId} projectId={projectId} onOpen={open} />}

      {openTask && (
        <TaskDrawer key={openTask} orgId={orgId} taskId={openTask} members={d.members} labels={d.labels} milestones={d.milestones} isManager={isManager}
          onClose={close} onChanged={changed} onLabelsChanged={load} onOpen={open} />
      )}
    </div>
  );
}

function ProjectPeople({ orgId, projectId, members, canManage, reload }: { orgId: number; projectId: number; members: Member[]; canManage: boolean; reload: () => void }) {
  const o = orgApi(orgId);
  const toast = useToast();
  const { user } = useSession();
  const [everyone, setEveryone] = useState<Member[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { if (canManage) api.get<{ members: Member[] }>(o('/members')).then((r) => setEveryone(r.members)); }, [canManage, orgId]);
  const outside = everyone.filter((m) => !members.some((x) => x.id === m.id));

  async function add() {
    if (!pick) return;
    try { await api.post(o(`/projects/${projectId}/members`), { userId: Number(pick) }); setPick(''); reload(); toast({ tone: 'ok', text: 'Added to the project' }); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }
  async function remove(m: Member) {
    try { await api.del(o(`/projects/${projectId}/members/${m.id}`)); reload(); toast({ tone: 'ok', text: `${m.name} left the project. Their open tasks are now unassigned.` }); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }
  return (
    <div className="card">
      <ul className="people-list">
        {members.map((m) => (
          <li key={m.id}>
            <Avatar name={m.name} size={34} />
            <div className="grow"><strong>{m.name}{m.id === user?.id && ' (you)'}</strong><span className="muted small">{m.email}</span></div>
            <span className={`pill role-${m.role}`}>{m.role}</span>
            {canManage && m.id !== user?.id && <button className="btn btn-sm" onClick={() => remove(m)}>Remove</button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="inline-form add-person">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person to add">
            <option value="">{outside.length ? 'Choose someone from your organisation…' : 'Everyone is already on this project'}</option>
            {outside.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!pick} onClick={add}>Add to project</button>
        </div>
      )}
    </div>
  );
}

function ProjectActivity({ orgId, projectId, onOpen }: { orgId: number; projectId: number; onOpen: (id: number) => void }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  useEffect(() => { api.get<{ activity: ActivityItem[] }>(orgApi(orgId)(`/projects/${projectId}/activity`)).then((r) => setItems(r.activity)); }, [orgId, projectId]);
  if (!items) return <Spinner />;
  if (!items.length) return <div className="card"><Empty title="Nothing has happened yet">Changes to tasks will be listed here.</Empty></div>;
  return (
    <div className="card">
      <ol className="timeline big">
        {items.map((a) => (
          <li key={a.id}>
            <Avatar name={a.actor_name} size={26} />
            <span className="grow">
              {a.task_id ? <button className="link-btn" onClick={() => onOpen(a.task_id!)}>{describe(a)}</button> : describe(a)}
            </span>
            <time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProjectOverview({ orgId, projectId, d, reload, showMilestone }: {
  orgId: number; projectId: number; d: Detail; reload: () => void; showMilestone: (id: number) => void;
}) {
  const o = orgApi(orgId);
  const toast = useToast();
  const [form, setForm] = useState({ name: '', due: '' });
  const [adding, setAdding] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(o(`/projects/${projectId}/milestones`), { name: form.name, dueAt: fromDateInput(form.due) });
      setForm({ name: '', due: '' }); setAdding(false); reload();
      toast({ tone: 'ok', text: 'Milestone added. Link tasks to it from each task.' });
    } catch (err: any) { toast({ tone: 'warn', text: err.details?.name ?? err.message }); }
  }
  async function remove(m: Milestone) {
    try { await api.del(o(`/projects/${projectId}/milestones/${m.id}`)); reload(); toast({ tone: 'ok', text: `Milestone removed. Its ${m.total} tasks are kept.` }); }
    catch (err: any) { toast({ tone: 'warn', text: err.message }); }
  }
  const s = d.stats;
  return (
    <div className="overview">
      <div className="overview-stats">
        <div className="card stat">
          <span className="tile-title">Progress</span>
          <span className="tile-value">{pct(s.progress)}</span>
          <ProgressBar value={s.progress} label="Progress" />
          <span className="tile-formula">= {s.done} done ÷ {s.total} tasks</span>
        </div>
        <div className="card stat">
          <span className="tile-title">Weighted progress</span>
          <span className="tile-value">{pct(s.weightedProgress)}</span>
          <ProgressBar value={s.weightedProgress} label="Weighted progress" />
          <span className="tile-formula">= points done ÷ all points · urgent 4, high 3, medium 2, low 1</span>
        </div>
        <div className={`card stat ${s.overdue ? 'tile-late' : ''}`}>
          <span className="tile-title">Running late</span>
          <span className="tile-value">{s.overdue}</span>
          <span className="tile-foot">{s.overdue ? 'Open tasks past their due date' : 'Nothing is late.'}</span>
          <span className="tile-formula">= open tasks with a due date before now</span>
        </div>
      </div>

      <section className="card">
        <div className="chart-head">
          <h3>Milestones</h3>
          {d.canManage && !adding && <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add milestone</button>}
        </div>
        {adding && (
          <form onSubmit={add} className="inline-form milestone-form">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Beta ready" aria-label="Milestone name" />
            <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} aria-label="Milestone date" />
            <button className="btn btn-primary btn-sm" disabled={!form.name.trim()}>Add</button>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </form>
        )}
        {d.milestones.length === 0 ? (
          <p className="muted">No milestones yet. {d.canManage ? 'Milestones are dated checkpoints, like "Content ready" or "Launch".' : 'A manager can add dated checkpoints here.'}</p>
        ) : (
          <ol className="milestones">
            {d.milestones.map((m) => {
              const late = m.due_at && new Date(m.due_at).getTime() < Date.now() && m.done < m.total;
              const finished = m.total > 0 && m.done === m.total;
              return (
                <li key={m.id} className={finished ? 'is-done' : ''}>
                  <span className="ms-dot" aria-hidden>{finished && <Icon name="check" size={12} />}</span>
                  <div className="grow">
                    <div className="ms-top">
                      <button className="link-btn ms-name" onClick={() => showMilestone(m.id)} title="Show these tasks on the board">{m.name}</button>
                      <span className={`due ${late ? 'due-late' : ''}`}>{late && <Icon name="clock" size={13} />}{m.due_at ? dueLabel(m.due_at, finished) : 'No date'}</span>
                    </div>
                    <ProgressBar value={m.progress ?? 0} label={`${m.name} progress`} />
                    <span className="ms-meta">{m.total ? `${m.done} of ${m.total} tasks done` : 'No tasks linked yet'}{m.overdue ? ` · ${m.overdue} late` : ''}</span>
                  </div>
                  {d.canManage && <button className="icon-btn sm" onClick={() => remove(m)} aria-label={`Remove milestone ${m.name}`}><Icon name="x" size={14} /></button>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="card">
        <h3>People on this project</h3>
        <ul className="overview-people">
          {d.members.map((m) => <li key={m.id}><Avatar name={m.name} size={30} /><span>{m.name}<small className="muted">{m.role}</small></span></li>)}
        </ul>
      </section>
    </div>
  );
}
