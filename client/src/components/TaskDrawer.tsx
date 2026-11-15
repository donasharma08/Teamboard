import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, orgApi } from '../lib/api';
import { describe } from '../lib/activity';
import { dueLabel, fileSize, fromDateInput, timeAgo, toDateInput } from '../lib/format';
import { useSession } from '../lib/session';
import { LABEL_COLORS, PRIORITIES, STATUSES, type ActivityItem, type Attachment, type Comment, type Label, type Member, type Milestone, type Task } from '../lib/types';
import { Avatar, Spinner, useToast } from './ui';
import { Icon } from './Icon';

interface Detail { task: Task; parent: { id: number; title: string } | null; subtasks: Task[]; comments: Comment[]; attachments: Attachment[]; activity: ActivityItem[] }

export function TaskDrawer({ orgId, taskId, members, labels, milestones, isManager, onClose, onChanged, onLabelsChanged, onOpen }: {
  orgId: number; taskId: number; members: Member[]; labels: Label[]; milestones: Milestone[]; isManager: boolean;
  onClose: () => void; onChanged: () => void; onLabelsChanged: () => void; onOpen: (id: number) => void;
}) {
  const o = orgApi(orgId);
  const toast = useToast();
  const { user } = useSession();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<Detail>(o(`/tasks/${taskId}`)).then((r) => { setD(r); setMissing(false); }).catch((e) => e.status === 404 && setMissing(true));
  }, [orgId, taskId]);
  useEffect(() => { setD(null); load(); }, [load]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea, input')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);

  /** Every save sends the version we loaded. If someone else saved first, the server says 409 and we reload. */
  async function save(patch: Record<string, unknown>, quiet = false) {
    if (!d) return;
    try {
      const r = await api.patch<{ task: Task }>(o(`/tasks/${d.task.id}`), { ...patch, version: d.task.version });
      setD((x) => x && { ...x, task: r.task });
      onChanged();
      if (!quiet) toast({ tone: 'ok', text: 'Saved' });
      load();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 409) {
        toast({ tone: 'warn', text: 'Someone else edited this task a moment ago. You are now seeing their latest version.' });
        load();
      } else toast({ tone: 'warn', text: e.message });
    }
  }

  async function archive() {
    if (!d) return;
    const t = d.task;
    try {
      await api.del(o(`/tasks/${t.id}`));
      onChanged();
      onClose();
      toast({ tone: 'ok', text: `Removed "${t.title}"`, action: { label: 'Undo', run: async () => { await api.post(o(`/tasks/${t.id}/restore`)); onChanged(); } } });
    } catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }

  const canArchive = d && (isManager || d.task.created_by === user?.id);

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Task details" tabIndex={-1} ref={panel}>
        <header className="drawer-head">
          {d?.parent ? (
            <button className="link-btn" onClick={() => onOpen(d.parent!.id)}><Icon name="subtask" size={14} /> Subtask of {d.parent.title}</button>
          ) : <span className="muted small">Task #{taskId}</span>}
          <span className="spacer" />
          {canArchive && <button className="icon-btn" onClick={archive} title="Remove task" aria-label="Remove task"><Icon name="trash" /></button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close task"><Icon name="x" /></button>
        </header>

        {missing ? (
          <div className="drawer-body"><p>This task was removed, or you no longer have access to it.</p></div>
        ) : !d ? <Spinner /> : (
          <div className="drawer-body">
            <TitleEditor key={`t${d.task.id}-${d.task.version}`} value={d.task.title} onSave={(title) => save({ title }, true)} />

            <dl className="props">
              <dt>Status</dt>
              <dd>
                <select value={d.task.status} onChange={(e) => save({ status: e.target.value }, true)} className={`status-select st-${d.task.status}`}>
                  {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </dd>
              <dt>Assignee</dt>
              <dd className="with-avatar">
                <Avatar name={d.task.assignee_name} size={24} />
                <select value={d.task.assignee_id ?? ''} onChange={(e) => save({ assigneeId: e.target.value ? Number(e.target.value) : null }, true)}>
                  <option value="">Nobody yet</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === user?.id ? ' (you)' : ''}</option>)}
                </select>
              </dd>
              <dt>Due</dt>
              <dd className="with-avatar">
                <input type="date" value={toDateInput(d.task.due_at)} onChange={(e) => save({ dueAt: fromDateInput(e.target.value) }, true)} aria-label="Due date" />
                <span className={`due ${d.task.is_overdue ? 'due-late' : ''}`}>{d.task.is_overdue && <Icon name="clock" size={13} />}{d.task.due_at ? dueLabel(d.task.due_at, d.task.status === 'done') : ''}</span>
              </dd>
              <dt>Priority</dt>
              <dd>
                <div className="seg" role="radiogroup" aria-label="Priority">
                  {[...PRIORITIES].reverse().map((p) => (
                    <button key={p.key} role="radio" aria-checked={d.task.priority === p.key}
                      className={`seg-btn prio-${p.key} ${d.task.priority === p.key ? 'on' : ''}`} onClick={() => save({ priority: p.key }, true)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </dd>
              {!d.task.parent_id && milestones.length > 0 && (<>
                <dt>Milestone</dt>
                <dd>
                  <select value={d.task.milestone_id ?? ''} onChange={(e) => save({ milestoneId: e.target.value ? Number(e.target.value) : null }, true)} aria-label="Milestone">
                    <option value="">None</option>
                    {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </dd>
              </>)}
              <dt>Labels</dt>
              <dd><LabelPicker orgId={orgId} projectId={d.task.project_id} all={labels} chosen={d.task.labels}
                onChange={(ids) => save({ labelIds: ids }, true)} onCreated={onLabelsChanged} /></dd>
            </dl>

            <section className="drawer-section">
              <h4>Notes</h4>
              <NotesEditor key={`d${d.task.id}-${d.task.version}`} value={d.task.description} onSave={(description) => save({ description })} />
            </section>

            {!d.task.parent_id && (
              <Subtasks orgId={orgId} task={d.task} subtasks={d.subtasks} reload={load} onChanged={onChanged} onOpen={onOpen} />
            )}

            <Files orgId={orgId} task={d.task} files={d.attachments} reload={() => { load(); onChanged(); }} isManager={isManager} />

            <Comments orgId={orgId} task={d.task} comments={d.comments} reload={() => { load(); onChanged(); }} isManager={isManager} />

            <section className="drawer-section">
              <h4>History</h4>
              {d.activity.length === 0 ? <p className="muted small">No changes yet.</p> : (
                <ol className="timeline">
                  {d.activity.map((a) => (
                    <li key={a.id}><span>{describe(a)}</span><time dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</time></li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function TitleEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => { const t = v.trim(); if (!t) setV(value); else if (t !== value) onSave(t); };
  return (
    <textarea className="title-input" rows={1} value={v} aria-label="Task title"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ''))}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === 'Escape') setV(value); }} />
  );
}

function NotesEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const dirty = v !== value;
  return (
    <div className="notes">
      <textarea rows={4} value={v} onChange={(e) => setV(e.target.value)} placeholder="Add context, links, or what done looks like…" aria-label="Notes" />
      {dirty && (
        <div className="row-end">
          <button className="btn btn-sm" onClick={() => setV(value)}>Discard</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(v)}>Save notes</button>
        </div>
      )}
    </div>
  );
}

function LabelPicker({ orgId, projectId, all, chosen, onChange, onCreated }: {
  orgId: number; projectId: number; all: Label[]; chosen: Label[]; onChange: (ids: number[]) => void; onCreated: () => void;
}) {
  const ids = chosen.map((l) => l.id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const toast = useToast();
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const r = await api.post<{ label: Label }>(orgApi(orgId)(`/projects/${projectId}/labels`), { name, color });
      onCreated();
      onChange([...ids, r.label.id]);
      setName(''); setAdding(false);
    } catch (err: any) { toast({ tone: 'warn', text: err.status === 409 ? 'A label with that name already exists' : err.message }); }
  }
  return (
    <div className="label-pick">
      {all.map((l) => {
        const on = ids.includes(l.id);
        return (
          <button key={l.id} className={`label tone-${l.color} ${on ? 'on' : 'off'}`} aria-pressed={on}
            onClick={() => onChange(on ? ids.filter((x) => x !== l.id) : [...ids, l.id])}>
            {on && <Icon name="check" size={11} />}{l.name}
          </button>
        );
      })}
      {adding ? (
        <form onSubmit={create} className="label-new">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" maxLength={30} aria-label="New label name" />
          <div className="swatches" role="radiogroup" aria-label="Label colour">
            {LABEL_COLORS.map((c) => (
              <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c}
                className={`swatch tone-${c} ${color === c ? 'on' : ''}`} onClick={() => setColor(c)} />
            ))}
          </div>
          <button className="btn btn-sm btn-primary">Add</button>
          <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : <button className="link-btn small" onClick={() => setAdding(true)}><Icon name="plus" size={13} /> New label</button>}
    </div>
  );
}

function Subtasks({ orgId, task, subtasks, reload, onChanged, onOpen }: {
  orgId: number; task: Task; subtasks: Task[]; reload: () => void; onChanged: () => void; onOpen: (id: number) => void;
}) {
  const o = orgApi(orgId);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const done = subtasks.filter((s) => s.status === 'done').length;
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try { await api.post(o(`/projects/${task.project_id}/tasks`), { title, parentId: task.id }); setTitle(''); reload(); onChanged(); }
    catch (err: any) { toast({ tone: 'warn', text: err.message }); }
  }
  async function toggle(s: Task) {
    try { await api.patch(o(`/tasks/${s.id}`), { status: s.status === 'done' ? 'todo' : 'done', version: s.version }); reload(); onChanged(); }
    catch (err: any) { toast({ tone: 'warn', text: err.message }); reload(); }
  }
  return (
    <section className="drawer-section">
      <h4>Checklist {subtasks.length > 0 && <span className="count">{done}/{subtasks.length}</span>}</h4>
      <ul className="subtasks">
        {subtasks.map((s) => (
          <li key={s.id} className={s.status === 'done' ? 'is-done' : ''}>
            <input type="checkbox" checked={s.status === 'done'} onChange={() => toggle(s)} aria-label={`Mark "${s.title}" ${s.status === 'done' ? 'not done' : 'done'}`} />
            <button className="link-btn sub-title" onClick={() => onOpen(s.id)}>{s.title}</button>
            {s.assignee_name && <Avatar name={s.assignee_name} size={20} />}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="inline-form">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a step…" aria-label="New subtask" />
        <button className="btn btn-sm" disabled={!title.trim()}>Add</button>
      </form>
    </section>
  );
}

function Files({ orgId, task, files, reload, isManager }: { orgId: number; task: Task; files: Attachment[]; reload: () => void; isManager: boolean }) {
  const o = orgApi(orgId);
  const toast = useToast();
  const { user } = useSession();
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function upload(f: File) {
    if (f.size > 5 * 1024 * 1024) { toast({ tone: 'warn', text: 'That file is larger than 5 MB. Try compressing it first.' }); return; }
    setUploading(true);
    const fd = new FormData();
    fd.append('file', f);
    try { await api.post(o(`/tasks/${task.id}/attachments`), fd); toast({ tone: 'ok', text: `Attached ${f.name}` }); reload(); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  }
  async function remove(a: Attachment) {
    try { await api.del(o(`/tasks/${task.id}/attachments/${a.id}`)); reload(); } catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }
  return (
    <section className="drawer-section">
      <h4>Files</h4>
      {files.length > 0 && (
        <ul className="files">
          {files.map((a) => (
            <li key={a.id}>
              <Icon name="clip" size={15} />
              <a href={o(`/tasks/${task.id}/attachments/${a.id}`)} download>{a.original_name}</a>
              <span className="muted small">{fileSize(a.size_bytes)} · {a.uploader_name} · {timeAgo(a.created_at)}</span>
              <span className="spacer" />
              {(isManager || a.uploader_id === user?.id) && <button className="icon-btn sm" onClick={() => remove(a)} aria-label={`Remove ${a.original_name}`}><Icon name="x" size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      <label className={`dropzone ${uploading ? 'busy' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
        <input ref={input} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.log,.csv,.zip,.docx,.xlsx,.pptx" />
        <Icon name="download" size={16} />
        <span>{uploading ? 'Uploading…' : <>Drop a file here or <u>choose one</u></>}</span>
        <small className="muted">Images, PDF, text, CSV, Office files or zip · up to 5 MB</small>
      </label>
    </section>
  );
}

function Comments({ orgId, task, comments, reload, isManager }: { orgId: number; task: Task; comments: Comment[]; reload: () => void; isManager: boolean }) {
  const o = orgApi(orgId);
  const toast = useToast();
  const { user } = useSession();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function post(e?: FormEvent) {
    e?.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try { await api.post(o(`/tasks/${task.id}/comments`), { body }); setBody(''); reload(); }
    catch (err: any) { toast({ tone: 'warn', text: err.message }); }
    finally { setBusy(false); }
  }
  async function remove(c: Comment) {
    try { await api.del(o(`/tasks/${task.id}/comments/${c.id}`)); reload(); } catch (e: any) { toast({ tone: 'warn', text: e.message }); }
  }
  return (
    <section className="drawer-section">
      <h4>Conversation {comments.length > 0 && <span className="count">{comments.length}</span>}</h4>
      {comments.length === 0 && <p className="muted small">No one has said anything yet. Questions, updates and decisions go here.</p>}
      <ul className="comments">
        {comments.map((c) => (
          <li key={c.id}>
            <Avatar name={c.author_name} size={28} />
            <div className="bubble">
              <div className="bubble-head">
                <strong>{c.author_name}</strong>
                <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>{timeAgo(c.created_at)}</time>
                {(c.author_id === user?.id || isManager) && <button className="link-btn small" onClick={() => remove(c)}>Delete</button>}
              </div>
              <p>{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={post} className="comment-form">
        <Avatar name={user?.name} size={28} />
        <div className="grow">
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" aria-label="Write a comment"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
          <div className="row-end">
            <span className="muted small">Ctrl + Enter to send</span>
            <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      </form>
    </section>
  );
}
