export type Role = 'owner' | 'manager' | 'employee';
export type Status = 'todo' | 'in_progress' | 'review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface User { id: number; name: string; email: string; emailNotifications?: boolean }
export interface OrgRef { id: number; name: string; role: Role }
export interface Label { id: number; name: string; color: string }
export interface Member { id: number; name: string; email: string; role: Role; open_tasks?: number; joined_at?: string }

export interface Task {
  id: number; project_id: number; parent_id: number | null; title: string; description: string;
  status: Status; priority: Priority; assignee_id: number | null; assignee_name: string | null; milestone_id: number | null; milestone_name: string | null;
  due_at: string | null; position: number; completed_at: string | null; version: number;
  created_by: number | null; created_at: string; updated_at: string; archived: boolean;
  subtask_count: number; subtask_done: number; comment_count: number; attachment_count: number;
  labels: Label[]; is_overdue: boolean;
}

export interface Project {
  id: number; name: string; description: string; status: 'active' | 'archived';
  team_id: number | null; team_name?: string | null; created_at: string;
  workspace_id?: number; workspace_name?: string;
  member_count?: number; task_count?: number; done_count?: number; overdue_count?: number; is_member?: boolean;
}

export interface Comment { id: number; body: string; created_at: string; author_id: number; author_name: string }
export interface Attachment {
  id: number; original_name: string; mime_type: string; size_bytes: number; created_at: string;
  uploader_id: number; uploader_name: string;
}
export interface ActivityItem {
  id: number; type: string; data: any; created_at: string; actor_name: string | null;
  task_id?: number | null; task_title?: string | null;
}
export interface Notification {
  id: number; type: string; message: string; task_id: number | null; project_id: number | null;
  read_at: string | null; created_at: string;
}

export const STATUSES: { key: Status; label: string; hint: string }[] = [
  { key: 'todo', label: 'To do', hint: 'Not started yet' },
  { key: 'in_progress', label: 'In progress', hint: 'Someone is on it' },
  { key: 'review', label: 'In review', hint: 'Waiting for a second look' },
  { key: 'done', label: 'Done', hint: 'Finished' },
];
export const STATUS_LABEL: Record<Status, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.label])) as any;
export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 'urgent', label: 'Urgent' }, { key: 'high', label: 'High' }, { key: 'medium', label: 'Medium' }, { key: 'low', label: 'Low' },
];
export const LABEL_COLORS = ['sage', 'ochre', 'plum', 'moss', 'clay', 'olive', 'amber', 'aubergine'];

export interface Milestone { id: number; name: string; due_at: string | null; total: number; done: number; overdue: number; progress: number | null }
