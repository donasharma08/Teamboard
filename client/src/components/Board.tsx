import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent, type Announcements, type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, orgApi } from '../lib/api';
import { dueLabel, positionBetween } from '../lib/format';
import { STATUSES, STATUS_LABEL, type Label, type Member, type Status, type Task } from '../lib/types';
import { Avatar, PriorityTag, usePoll, useToast } from './ui';
import { Icon } from './Icon';

type Columns = Record<Status, Task[]>;
const emptyCols = (): Columns => ({ todo: [], in_progress: [], review: [], done: [] });

function group(tasks: Task[]): Columns {
  const c = emptyCols();
  for (const t of tasks) c[t.status].push(t);
  for (const k of Object.keys(c) as Status[]) c[k].sort((a, b) => a.position - b.position || a.id - b.id);
  return c;
}

export interface Filters { q: string; assignee: string; priority: string; label: string; milestone: string; overdue: boolean }

export function Board({ orgId, projectId, members, labels, filters, onOpen, refreshKey, onChanged }: {
  orgId: number; projectId: number; members: Member[]; labels: Label[]; filters: Filters;
  onOpen: (id: number) => void; refreshKey: number; onChanged: () => void;
}) {
  const o = orgApi(orgId);
  const toast = useToast();
  const [cols, setCols] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const dragFrom = useRef<Status | null>(null);
  const busy = useRef(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.assignee) p.set('assignee', filters.assignee);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.label) p.set('label', filters.label);
    if (filters.overdue) p.set('overdue', '1');
    if (filters.milestone) p.set('milestone', filters.milestone);
    return p.toString();
  }, [filters]);
  const filtered = !!qs;

  const load = useCallback(() => {
    if (busy.current || activeId !== null) return;
    api.get<{ tasks: Task[] }>(o(`/projects/${projectId}/tasks?${qs}`)).then((r) => setCols(group(r.tasks))).catch(() => {});
  }, [orgId, projectId, qs, activeId]);
  useEffect(load, [load, refreshKey]);
  usePoll(load, 10000);

  // Left/Right jump to the neighbouring column; Up/Down reorder inside a column.
  const currentCol = useRef<Status | null>(null);
  const keyboardCoords: KeyboardCoordinateGetter = (event, args) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const order = STATUSES.map((s) => s.key);
    const from = currentCol.current ?? 'todo';
    const next = order[order.indexOf(from) + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = next && args.context.droppableRects.get(next);
    if (!rect) return undefined;
    return { x: rect.left + 4, y: rect.top + 4 };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoords,
      // Space picks up / drops. Enter is kept free for "open the task".
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const findCol = (id: number | string, c = cols): Status | null => {
    if (!c) return null;
    if (typeof id === 'string' && id in c) return id as Status;
    return (Object.keys(c) as Status[]).find((k) => c[k].some((t) => t.id === id)) ?? null;
  };
  const taskById = (id: number) => cols && Object.values(cols).flat().find((t) => t.id === id);

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(e.active.id));
    dragFrom.current = findCol(Number(e.active.id));
    currentCol.current = dragFrom.current;
  }

  function onDragOver(e: DragOverEvent) {
    if (!cols || !e.over) return;
    const from = findCol(Number(e.active.id));
    const to = findCol(e.over.id as any);
    if (!from || !to || from === to) return;
    currentCol.current = to;
    setCols((c) => {
      if (!c) return c;
      const moving = c[from].find((t) => t.id === Number(e.active.id))!;
      const overIdx = c[to].findIndex((t) => t.id === e.over!.id);
      const idx = overIdx >= 0 ? overIdx : c[to].length;
      return { ...c, [from]: c[from].filter((t) => t.id !== moving.id), [to]: [...c[to].slice(0, idx), { ...moving, status: to }, ...c[to].slice(idx)] };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const id = Number(e.active.id);
    setActiveId(null);
    if (!cols || !e.over) { load(); return; }
    const col = findCol(id)!;
    let list = cols[col];
    const oldIdx = list.findIndex((t) => t.id === id);
    const overIdx = list.findIndex((t) => t.id === e.over!.id);
    if (overIdx >= 0 && overIdx !== oldIdx) list = arrayMove(list, oldIdx, overIdx);
    const idx = list.findIndex((t) => t.id === id);
    const position = positionBetween(list[idx - 1]?.position, list[idx + 1]?.position);
    const task = list[idx];
    const original = dragFrom.current;
    if (original === col && (overIdx === -1 || overIdx === oldIdx)) return; // dropped where it started
    setCols({ ...cols, [col]: list.map((t) => (t.id === id ? { ...t, position } : t)) });
    await move(task, col, position, original ?? col);
  }

  async function move(task: Task, to: Status, position: number, from: Status) {
    busy.current = true;
    try {
      const r = await api.patch<{ task: Task }>(o(`/tasks/${task.id}`), { status: to, position, version: task.version });
      setCols((c) => c && { ...c, [to]: c[to].map((t) => (t.id === task.id ? r.task : t)) });
      if (from !== to) {
        toast({
          tone: 'ok', text: to === 'done' ? `"${task.title}" is done. Well done.` : `Moved to ${STATUS_LABEL[to]}`,
          action: { label: 'Undo', run: async () => { await api.patch(o(`/tasks/${task.id}`), { status: from, version: r.task.version }).catch(() => {}); busy.current = false; load(); onChanged(); } },
        });
        onChanged();
      }
    } catch (e: any) {
      toast({ tone: 'warn', text: e.status === 409 ? 'Someone else just changed that task. The board has been refreshed.' : e.message });
    } finally {
      busy.current = false;
      if (from !== to) load();
    }
  }

  async function moveWithMenu(task: Task, to: Status) {
    if (!cols || to === task.status) return;
    const last = cols[to][cols[to].length - 1];
    const position = positionBetween(last?.position, undefined);
    setCols({ ...cols, [task.status]: cols[task.status].filter((t) => t.id !== task.id), [to]: [...cols[to], { ...task, status: to, position }] });
    await move(task, to, position, task.status);
  }

  async function quickAdd(status: Status, title: string) {
    const r = await api.post<{ task: Task }>(o(`/projects/${projectId}/tasks`), { title, status });
    setCols((c) => c && { ...c, [status]: [...c[status], r.task] });
    onChanged();
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up "${taskById(Number(active.id))?.title}". Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => over ? `"${taskById(Number(active.id))?.title}" is over ${STATUS_LABEL[findCol(over.id as any) as Status] ?? 'a column'}.` : '',
    onDragEnd: ({ active, over }) => over ? `Dropped "${taskById(Number(active.id))?.title}" in ${STATUS_LABEL[findCol(over.id as any) as Status]}.` : 'Dropped.',
    onDragCancel: ({ active }) => `Cancelled. "${taskById(Number(active.id))?.title}" is back where it was.`,
  };

  if (!cols) return <div className="board skeleton-board" aria-busy="true">{STATUSES.map((s) => <div key={s.key} className="column skeleton" />)}</div>;
  const active = activeId ? taskById(activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver}
      onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); load(); }} accessibility={{ announcements }}>
      <div className="board">
        {STATUSES.map((s) => (
          <Column key={s.key} status={s.key} hint={s.hint} tasks={cols[s.key]} filtered={filtered}
            onOpen={onOpen} onMove={moveWithMenu} onAdd={quickAdd} members={members} labels={labels} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {active ? <Card task={active} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ status, hint, tasks, filtered, onOpen, onMove, onAdd }: {
  status: Status; hint: string; tasks: Task[]; filtered: boolean; members: Member[]; labels: Label[];
  onOpen: (id: number) => void; onMove: (t: Task, s: Status) => void; onAdd: (s: Status, title: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!title.trim()) { setAdding(false); return; }
    setSaving(true);
    try { await onAdd(status, title.trim()); setTitle(''); }
    catch (e: any) { toast({ tone: 'warn', text: e.message }); }
    finally { setSaving(false); }
  }

  return (
    <section className={`column col-${status} ${isOver ? 'is-over' : ''}`} aria-label={`${STATUS_LABEL[status]} column, ${tasks.length} tasks`}>
      <header className="column-head">
        <span className="col-dot" aria-hidden />
        <h3>{STATUS_LABEL[status]}</h3>
        <span className="count">{tasks.length}</span>
      </header>
      <SortableContext id={status} items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column-body">
          {tasks.map((t) => <SortableCard key={t.id} task={t} onOpen={onOpen} onMove={onMove} />)}
          {tasks.length === 0 && !adding && (
            <p className="column-empty">{filtered ? 'Nothing here matches your filters.' : status === 'done' ? 'Finished work lands here.' : hint + '. Drop a card here.'}</p>
          )}
        </div>
      </SortableContext>
      {adding ? (
        <div className="quick-add">
          <textarea autoFocus rows={2} value={title} disabled={saving} placeholder="What needs doing?"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { setAdding(false); setTitle(''); }
            }}
            onBlur={() => !title.trim() && setAdding(false)} aria-label={`New task in ${STATUS_LABEL[status]}`} />
          <div className="quick-add-actions">
            <button className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={saving}>Add task</button>
            <span className="muted small">Enter to add, Esc to close</span>
          </div>
        </div>
      ) : (
        <button className="add-card" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a task</button>
      )}
    </section>
  );
}

function SortableCard({ task, onOpen, onMove }: { task: Task; onOpen: (id: number) => void; onMove: (t: Task, s: Status) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(task.id); return; }
    listeners?.onKeyDown?.(e as any);
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onKeyDown={onKeyDown}
      className={`card-wrap ${isDragging ? 'is-dragging' : ''}`}
      aria-roledescription="task card"
      aria-label={`${task.title}. ${task.priority} priority. ${task.assignee_name ? `Assigned to ${task.assignee_name}` : 'Unassigned'}. ${dueLabel(task.due_at, task.status === 'done')}. Press Enter to open, Space to pick up.`}
      onClick={() => onOpen(task.id)}>
      <Card task={task} onMove={onMove} />
    </div>
  );
}

function Card({ task, overlay, onMove }: { task: Task; overlay?: boolean; onMove?: (t: Task, s: Status) => void }) {
  const done = task.status === 'done';
  return (
    <article className={`task-card prio-edge-${task.priority} ${overlay ? 'is-overlay' : ''} ${done ? 'is-done' : ''}`}>
      {task.labels.length > 0 && (
        <div className="card-labels">{task.labels.map((l) => <span key={l.id} className={`label tone-${l.color}`}>{l.name}</span>)}</div>
      )}
      <p className="card-title">{task.title}</p>
      <div className="card-meta">
        {task.priority !== 'medium' && <PriorityTag p={task.priority} />}
        {task.due_at && (
          <span className={`due ${task.is_overdue ? 'due-late' : ''}`}>
            <Icon name={task.is_overdue ? 'clock' : 'calendar'} size={13} />{dueLabel(task.due_at, done)}
          </span>
        )}
        {task.subtask_count > 0 && <span className="meta-chip" title="Subtasks done"><Icon name="subtask" size={13} />{task.subtask_done}/{task.subtask_count}</span>}
        {task.comment_count > 0 && <span className="meta-chip" title="Comments"><Icon name="comment" size={13} />{task.comment_count}</span>}
        {task.attachment_count > 0 && <span className="meta-chip" title="Files"><Icon name="clip" size={13} />{task.attachment_count}</span>}
        <span className="spacer" />
        <Avatar name={task.assignee_name} size={24} />
      </div>
      {onMove && (
        <label className="card-move" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <span className="sr-only">Move "{task.title}" to</span>
          <select value={task.status} onChange={(e) => onMove(task, e.target.value as Status)} aria-label={`Move "${task.title}" to another column`}>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.key === task.status ? `In ${s.label}` : `Move to ${s.label}`}</option>)}
          </select>
        </label>
      )}
    </article>
  );
}
