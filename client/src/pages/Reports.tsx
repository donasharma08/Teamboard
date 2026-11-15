import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, orgApi } from '../lib/api';
import { pct, shortDate } from '../lib/format';
import { useOrg } from '../lib/session';
import { STATUS_LABEL, type Project, type Status } from '../lib/types';
import { Avatar, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

interface Ratio { num: number; den: number; value: number | null }
interface Report {
  window: { from: string; to: string };
  metrics: {
    completionRate: Ratio; onTimeRate: Ratio; overdueCount: number; assignmentCoverage: Ratio; progress: Ratio; weightedProgress: Ratio;
    notifications: { inApp: { created: number; read: number }; email: { sent: number; logged: number; failed: number; pending: number }; emailConfigured: boolean };
  };
  statusDistribution: { status: Status; count: number }[];
  workload: { id: number; name: string; role: string; open: number; overdue: number; completed: number }[];
  trend: { week: string; completed: number; created: number }[];
  projects: { id: number; name: string; total: number; done: number; overdue: number; progress: number | null }[];
}
interface Workspace { id: number; name: string }

const RANGES = [{ days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }];
const fraction = (r: Ratio, unit: string) => (r.den ? `${r.num} of ${r.den} ${unit}` : `No ${unit} to count yet`);

export function Reports() {
  const orgId = Number(useParams().orgId);
  const o = orgApi(orgId);
  const { isManager } = useOrg(orgId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [scope, setScope] = useState(''); // '' | 'w:<id>' | 'p:<id>'
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    api.get<{ projects: Project[] }>(o('/projects')).then((x) => setProjects(x.projects));
    api.get<{ workspaces: Workspace[] }>(o('/workspaces')).then((x) => setWorkspaces(x.workspaces));
  }, [orgId]);
  useEffect(() => {
    const from = new Date(Date.now() - days * 864e5).toISOString();
    const p = new URLSearchParams({ from, to: new Date().toISOString() });
    if (scope.startsWith('p:')) p.set('projectId', scope.slice(2));
    if (scope.startsWith('w:')) p.set('workspaceId', scope.slice(2));
    setR(null);
    api.get<Report>(o(`/reports?${p}`)).then(setR);
  }, [orgId, scope, days]);

  if (!isManager) return <Navigate to={`/o/${orgId}/my-work`} replace />;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1>How the work is going</h1>
          <p className="lede">Numbers update as tasks move. Each one shows what it was worked out from.</p>
        </div>
      </header>
      <div className="filters">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="What to report on">
          <option value="">Whole organisation</option>
          {workspaces.map((w) => (
            <optgroup key={w.id} label={w.name}>
              <option value={`w:${w.id}`}>All of {w.name}</option>
              {projects.filter((p) => p.workspace_id === w.id).map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="seg" role="radiogroup" aria-label="Time range">
          {RANGES.map((x) => (
            <button key={x.days} role="radio" aria-checked={days === x.days} className={`seg-btn ${days === x.days ? 'on' : ''}`} onClick={() => setDays(x.days)}>{x.label}</button>
          ))}
        </div>
      </div>

      {!r ? <Spinner /> : (
        <>
          <div className="tiles">
            <Tile title="Completion rate" value={pct(r.metrics.completionRate.value)}
              foot={fraction(r.metrics.completionRate, 'tasks created in this period are done')}
              formula="done ÷ tasks created in the period" />
            <Tile title="Finished on time" value={pct(r.metrics.onTimeRate.value)}
              foot={fraction(r.metrics.onTimeRate, 'finished tasks met their due date')}
              formula="finished by due date ÷ finished with a due date" />
            <Tile title="Running late right now" value={String(r.metrics.overdueCount)} tone={r.metrics.overdueCount ? 'late' : undefined}
              foot={r.metrics.overdueCount ? 'Open tasks past their due date' : 'Nothing is late. Lovely.'}
              formula="open tasks with due date before now (UTC)" />
            <Tile title="Has an owner" value={pct(r.metrics.assignmentCoverage.value)}
              foot={fraction(r.metrics.assignmentCoverage, 'open tasks are assigned')}
              formula="open tasks with an assignee ÷ open tasks" />
            <Tile title="Progress" value={pct(r.metrics.progress.value)}
              foot={fraction(r.metrics.progress, 'tasks are done')}
              formula="done ÷ all counted tasks" />
            <Tile title="Weighted progress" value={pct(r.metrics.weightedProgress.value)}
              foot={r.metrics.weightedProgress.den ? `${r.metrics.weightedProgress.num} of ${r.metrics.weightedProgress.den} points done` : 'No tasks to count yet'}
              formula="points done ÷ all points (urgent 4, high 3, medium 2, low 1)" />
          </div>

          <div className="report-grid">
            <section className="card chart-card">
              <h3>Where tasks are now</h3>
              <StatusBar data={r.statusDistribution} />
            </section>

            <section className="card chart-card wide">
              <div className="chart-head">
                <h3>Tasks added and finished, by week</h3>
                <label className="toggle"><input type="checkbox" checked={asTable} onChange={(e) => setAsTable(e.target.checked)} /> Show as table</label>
              </div>
              {asTable ? <TrendTable data={r.trend} /> : <TrendChart data={r.trend} />}
            </section>

            <section className="card wide">
              <h3>Who has what</h3>
              <table className="table">
                <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Late</th><th className="num">Finished</th><th aria-label="Load" /></tr></thead>
                <tbody>
                  {r.workload.map((w) => {
                    const max = Math.max(1, ...r.workload.map((x) => x.open));
                    return (
                      <tr key={w.id}>
                        <td><span className="with-avatar"><Avatar name={w.name} size={22} /> {w.name}</span></td>
                        <td className="num">{w.open}</td>
                        <td className={`num ${w.overdue ? 'late-num' : ''}`}>{w.overdue}</td>
                        <td className="num">{w.completed}</td>
                        <td className="bar-cell"><span className="mini-bar" style={{ width: `${(w.open / max) * 100}%` }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">"Finished" counts tasks completed in the selected period.</p>
            </section>

            <section className="card">
              <h3>Notifications</h3>
              <dl className="notif-stats">
                <div><dt>In-app sent</dt><dd>{r.metrics.notifications.inApp.created}</dd></div>
                <div><dt>In-app read</dt><dd>{r.metrics.notifications.inApp.read}</dd></div>
                <div><dt>Emails delivered</dt><dd>{r.metrics.notifications.email.sent}</dd></div>
                <div><dt>Emails logged, not delivered</dt><dd>{r.metrics.notifications.email.logged}</dd></div>
                <div><dt>Emails failed</dt><dd className={r.metrics.notifications.email.failed ? 'late-num' : ''}>{r.metrics.notifications.email.failed}</dd></div>
              </dl>
              <p className="muted small">
                {r.metrics.notifications.emailConfigured
                  ? 'Email is switched on. Failed emails are retried 3 times.'
                  : 'Email is not set up on this server (no SMTP_URL), so emails are written to the server log instead of being sent.'}
              </p>
            </section>

            <section className="card wide">
              <h3>Projects</h3>
              <table className="table">
                <thead><tr><th>Project</th><th className="num">Done</th><th className="num">Late</th><th className="num">Progress</th></tr></thead>
                <tbody>
                  {r.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{p.done}/{p.total}</td>
                      <td className={`num ${p.overdue ? 'late-num' : ''}`}>{p.overdue}</td>
                      <td className="num">{pct(p.progress)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="card how">
            <h3><Icon name="list" size={18} /> How each number is calculated</h3>
            <p className="muted">Period: {shortDate(r.window.from)} to {shortDate(r.window.to)}. All times are compared in UTC.</p>
            <dl className="how-list">
              <div><dt>Counted tasks</dt><dd>Top-level tasks (not checklist steps) that have not been removed, in active projects. Removed tasks are left out of every number.</dd></div>
              <div><dt>Completion rate</dt><dd>Counted tasks <em>created in the period</em> that are now done, divided by all counted tasks created in the period.</dd></div>
              <div><dt>Finished on time</dt><dd>Tasks finished in the period on or before their due date, divided by tasks finished in the period that had a due date. Tasks without a due date are not counted.</dd></div>
              <div><dt>Running late</dt><dd>Open tasks whose due date is earlier than right now. A due date picked as a day means 23:59 on that day.</dd></div>
              <div><dt>Has an owner</dt><dd>Open tasks with someone assigned, divided by all open tasks.</dd></div>
              <div><dt>Progress</dt><dd>Done tasks divided by all counted tasks, regardless of when they were created.</dd></div>
              <div><dt>Weighted progress</dt><dd>Each task is worth points by priority — urgent 4, high 3, medium 2, low 1. Points of done tasks divided by all points. A finished urgent task moves this more than a finished low one.</dd></div>
              <div><dt>Weekly chart</dt><dd>For the 8 weeks up to the end of the period (weeks start Monday): counted tasks added, and counted tasks finished.</dd></div>
              <div><dt>Notifications</dt><dd>In-app notifications created in the period, and how many have been read. Emails go out only for new assignments and overdue work, and are counted separately as delivered, logged (not delivered) or failed.</dd></div>
              <div><dt>When there is nothing to count</dt><dd>The number shows "—" instead of 0%.</dd></div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ title, value, foot, tone, formula }: { title: string; value: string; foot: string; tone?: string; formula: string }) {
  return (
    <div className={`tile card ${tone ? `tile-${tone}` : ''}`}>
      <span className="tile-title">{title}</span>
      <span className="tile-value">{value}</span>
      <span className="tile-foot">{foot}</span>
      <span className="tile-formula">= {formula}</span>
    </div>
  );
}

function StatusBar({ data }: { data: { status: Status; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return <p className="muted">No tasks yet.</p>;
  return (
    <div>
      <div className="seg-bar" role="img" aria-label={data.map((d) => `${STATUS_LABEL[d.status]}: ${d.count}`).join(', ')}>
        {data.filter((d) => d.count).map((d) => (
          <span key={d.status} className={`seg-part fill-${d.status}`} style={{ flexGrow: d.count }} title={`${STATUS_LABEL[d.status]}: ${d.count}`} />
        ))}
      </div>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.status}><span className={`swatch-dot fill-${d.status}`} aria-hidden />{STATUS_LABEL[d.status]}<strong>{d.count}</strong><span className="muted">{Math.round((d.count / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

function TrendChart({ data }: { data: Report['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...data.flatMap((d) => [d.created, d.completed])), [data]);
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 4));
    return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  }, [max]);
  const top = ticks[ticks.length - 1] || 1;
  return (
    <div className="trend">
      <ul className="legend inline">
        <li><span className="swatch-dot fill-created" aria-hidden />Added</li>
        <li><span className="swatch-dot fill-completed" aria-hidden />Finished</li>
      </ul>
      <div className="trend-plot">
        <div className="trend-grid" aria-hidden>
          {ticks.map((t) => <div key={t} className="grid-line" style={{ bottom: `${(t / top) * 100}%` }}><span>{t}</span></div>)}
        </div>
        <div className="trend-bars">
          {data.map((d, i) => (
            <div key={d.week} className={`week ${hover === i ? 'hover' : ''}`} tabIndex={0}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`Week of ${shortDate(d.week)}: ${d.created} added, ${d.completed} finished`}>
              <div className="pair">
                <span className="bar fill-created" style={{ height: `${(d.created / top) * 100}%` }} />
                <span className="bar fill-completed" style={{ height: `${(d.completed / top) * 100}%` }} />
              </div>
              <span className="week-label">{shortDate(d.week)}</span>
              {hover === i && (
                <div className="tip" role="tooltip">
                  <strong>Week of {shortDate(d.week)}</strong>
                  <span><i className="swatch-dot fill-created" />Added <b>{d.created}</b></span>
                  <span><i className="swatch-dot fill-completed" />Finished <b>{d.completed}</b></span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendTable({ data }: { data: Report['trend'] }) {
  return (
    <table className="table">
      <thead><tr><th>Week starting</th><th className="num">Added</th><th className="num">Finished</th></tr></thead>
      <tbody>{data.map((d) => <tr key={d.week}><td>{shortDate(d.week)}</td><td className="num">{d.created}</td><td className="num">{d.completed}</td></tr>)}</tbody>
    </table>
  );
}
