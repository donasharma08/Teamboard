import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, orgApi } from '../lib/api';
import { useOrg } from '../lib/session';
import type { Member, Project } from '../lib/types';
import { Avatar, Empty, Field, Modal, ProgressBar, Spinner, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Workspace { id: number; name: string; description: string; project_count: number }

export function Projects() {
  const orgId = Number(useParams().orgId);
  const o = orgApi(orgId);
  const { isManager, isOwner } = useOrg(orgId);
  const toast = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState<number | 'any' | null>(null);
  const [newWorkspace, setNewWorkspace] = useState(false);

  const load = useCallback(() => {
    api.get<{ projects: Project[] }>(o(`/projects${showArchived ? '?archived=1' : ''}`)).then((r) => setProjects(r.projects));
    api.get<{ workspaces: Workspace[] }>(o('/workspaces')).then((r) => setWorkspaces(r.workspaces));
  }, [orgId, showArchived]);
  useEffect(load, [load]);

  async function removeWorkspace(w: Workspace) {
    try { await api.del(o(`/workspaces/${w.id}`)); toast({ tone: 'ok', text: `Workspace "${w.name}" removed.` }); load(); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }

  // Employees only see workspaces that hold a project they are on.
  const shown = workspaces.filter((w) => isManager || projects?.some((p) => p.workspace_id === w.id));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="lede">{isManager ? 'Every project in your organisation, grouped by workspace.' : 'The projects you have been added to.'}</p>
        </div>
        <div className="head-actions">
          <label className="toggle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          {isManager && <button className="btn" onClick={() => setNewWorkspace(true)}><Icon name="folder" /> New workspace</button>}
          {isManager && <button className="btn btn-primary" onClick={() => setCreating('any')}><Icon name="plus" /> New project</button>}
        </div>
      </header>

      {!projects ? <Spinner /> : projects.length === 0 && !isManager ? (
        <div className="card">
          <Empty icon="folder" title="You are not on any projects yet"><p>When a manager adds you to a project, it will appear here.</p></Empty>
        </div>
      ) : (
        <div className="workspace-list">
          {shown.map((w) => {
            const list = projects.filter((p) => p.workspace_id === w.id);
            return (
              <section key={w.id} className="workspace" aria-labelledby={`ws-${w.id}`}>
                <header className="workspace-head">
                  <span className="workspace-icon" aria-hidden><Icon name="folder" size={16} /></span>
                  <div className="grow">
                    <h2 id={`ws-${w.id}`}>{w.name} <span className="count">{list.length}</span></h2>
                    {w.description && <p className="muted small">{w.description}</p>}
                  </div>
                  {isManager && <button className="btn btn-sm" onClick={() => setCreating(w.id)}><Icon name="plus" size={14} /> Project here</button>}
                  {isOwner && list.length === 0 && (
                    <button className="icon-btn sm" onClick={() => removeWorkspace(w)} aria-label={`Remove workspace ${w.name}`} title="Remove empty workspace"><Icon name="trash" size={15} /></button>
                  )}
                </header>
                {list.length === 0 ? (
                  <p className="workspace-empty">Nothing here yet. {isManager ? 'Start a project in this workspace.' : ''}</p>
                ) : (
                  <div className="project-grid">
                    {list.map((p) => {
                      const progress = p.task_count ? (p.done_count ?? 0) / p.task_count : 0;
                      return (
                        <Link key={p.id} to={`/o/${orgId}/projects/${p.id}`} className={`project-card card ${p.status === 'archived' ? 'is-archived' : ''}`}>
                          <div className="project-card-top">
                            <h3>{p.name}</h3>
                            {p.status === 'archived' && <span className="pill">Archived</span>}
                          </div>
                          <p className="muted clamp">{p.description || 'No description yet.'}</p>
                          <ProgressBar value={progress} label={`${p.name} progress`} />
                          <div className="project-card-meta">
                            <span>{p.done_count} of {p.task_count} done</span>
                            {!!p.overdue_count && <span className="due-late"><Icon name="clock" size={13} /> {p.overdue_count} late</span>}
                            <span className="spacer" />
                            {p.team_name && <span className="pill pill-soft">{p.team_name}</span>}
                            <span title="People on this project"><Icon name="users" size={14} /> {p.member_count}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {creating !== null && <NewProject orgId={orgId} workspaces={workspaces} defaultWorkspace={creating === 'any' ? workspaces[0]?.id : creating} onClose={() => setCreating(null)} />}
      {newWorkspace && <NewWorkspace orgId={orgId} onClose={() => setNewWorkspace(false)} onCreated={() => { setNewWorkspace(false); load(); }} />}
    </div>
  );
}

function NewWorkspace({ orgId, onClose, onCreated }: { orgId: number; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(orgApi(orgId)('/workspaces'), form);
      toast({ tone: 'ok', text: `Workspace "${form.name}" is ready.` });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.details ?? {}); if (!err.details) toast({ tone: 'warn', text: err.status === 409 ? 'A workspace with that name already exists' : err.message }); }
    }
  }
  return (
    <Modal title="New workspace" onClose={onClose}>
      <form onSubmit={submit} className="modal-body">
        <p className="muted" style={{ marginBottom: 14 }}>A workspace groups related projects, like "Client work" or "Internal".</p>
        <Field label="Name" error={errors.name}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="What goes in it?" hint="Optional"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.name.trim()}>Create workspace</button>
        </div>
      </form>
    </Modal>
  );
}

function NewProject({ orgId, workspaces, defaultWorkspace, onClose }: { orgId: number; workspaces: { id: number; name: string }[]; defaultWorkspace?: number; onClose: () => void }) {
  const o = orgApi(orgId);
  const nav = useNavigate();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({ name: '', description: '', teamId: '' as string, workspaceId: String(defaultWorkspace ?? ''), memberIds: [] as number[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ members: Member[] }>(o('/members')).then((r) => setMembers(r.members));
    api.get<{ teams: { id: number; name: string }[] }>(o('/teams')).then((r) => setTeams(r.teams));
  }, [orgId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ project: Project }>(o('/projects'), {
        name: form.name, description: form.description, teamId: form.teamId ? Number(form.teamId) : null,
        workspaceId: form.workspaceId ? Number(form.workspaceId) : null, memberIds: form.memberIds,
      });
      toast({ tone: 'ok', text: `"${r.project.name}" is ready. Add your first task.` });
      nav(`/o/${orgId}/projects/${r.project.id}`);
    } catch (err) {
      if (err instanceof ApiError) { setErrors(err.details ?? {}); if (!err.details) toast({ tone: 'warn', text: err.message }); }
      setBusy(false);
    }
  }

  const toggle = (id: number) => setForm((f) => ({ ...f, memberIds: f.memberIds.includes(id) ? f.memberIds.filter((x) => x !== id) : [...f.memberIds, id] }));

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} className="modal-body">
        <Field label="What is it called?" error={errors.name}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Autumn catalogue" /></Field>
        <Field label="What is it for?" hint="Optional. One or two sentences helps new people."><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Workspace">
          <select value={form.workspaceId} onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        {teams.length > 0 && (
          <Field label="Team" hint="Everyone in the team is added to the project.">
            <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
              <option value="">No team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <fieldset className="field">
          <legend className="field-label">Who else is working on it?</legend>
          <div className="people-pick">
            {members.map((m) => (
              <label key={m.id} className="person-check">
                <input type="checkbox" checked={form.memberIds.includes(m.id)} onChange={() => toggle(m.id)} />
                <Avatar name={m.name} size={24} /> {m.name}
              </label>
            ))}
          </div>
          <span className="field-hint">You are added automatically.</span>
        </fieldset>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}
