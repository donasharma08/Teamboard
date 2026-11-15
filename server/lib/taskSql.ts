/** Shared SELECT for a task "card": everything the board needs in one round trip. */
export const TASK_CARD = `
  t.id, t.project_id, t.parent_id, t.title, t.description, t.status, t.priority,
  t.assignee_id, u.name AS assignee_name, t.milestone_id, ms.name AS milestone_name, t.due_at, t.position, t.completed_at,
  t.version, t.created_by, t.created_at, t.updated_at, t.archived,
  (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id AND s.archived = false) AS subtask_count,
  (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id AND s.archived = false AND s.status = 'done') AS subtask_done,
  (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT count(*)::int FROM attachments a WHERE a.task_id = t.id) AS attachment_count,
  COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.name)
            FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = t.id), '[]') AS labels,
  (t.status <> 'done' AND t.archived = false AND t.due_at IS NOT NULL AND t.due_at < now()) AS is_overdue`;

export const TASK_FROM = `FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN milestones ms ON ms.id = t.milestone_id`;

export const STATUS_LABEL: Record<string, string> = {
  todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done',
};

/** Weighted progress gives bigger tasks more say: urgent 4, high 3, medium 2, low 1 (docs/METRICS.md). */
export const PRIORITY_WEIGHT = `(CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)`;
