import { STATUS_LABEL, type ActivityItem, type Status } from './types';
import { shortDate } from './format';

/** Turns an activity event into a sentence a person would actually say. */
export function describe(a: ActivityItem): string {
  const who = a.actor_name ?? 'Someone';
  const d = a.data ?? {};
  const title = d.title ? `"${d.title}"` : 'a task';
  switch (a.type) {
    case 'project.created': return `${who} started the project`;
    case 'project.updated': return d.status === 'archived' ? `${who} archived the project` : d.status === 'active' ? `${who} brought the project back` : `${who} updated the project details`;
    case 'project.member_added': return `${who} added ${d.name} to the project`;
    case 'member.added': return `${who} added ${d.name} as ${d.role}`;
    case 'task.created': return `${who} added ${title}`;
    case 'subtask.created': return `${who} added a subtask, ${title}`;
    case 'task.status': return d.to === 'done' ? `${who} finished ${title}` : `${who} moved ${title} to ${STATUS_LABEL[d.to as Status]}`;
    case 'task.assigned': return d.to ? `${who} gave ${title} to ${d.to}` : `${who} unassigned ${title}`;
    case 'task.due': return d.to ? `${who} set ${title} due ${shortDate(d.to)}` : `${who} removed the due date from ${title}`;
    case 'task.renamed': return `${who} renamed "${d.from}" to "${d.to}"`;
    case 'task.priority': return `${who} changed ${title} to ${d.to} priority`;
    case 'task.archived': return `${who} removed ${title}`;
    case 'task.restored': return `${who} restored ${title}`;
    case 'task.milestone': return d.to ? `${who} put ${title} in the "${d.to}" milestone` : `${who} took ${title} out of its milestone`;
    case 'milestone.created': return `${who} added the milestone "${d.name}"`;
    case 'milestone.deleted': return `${who} removed the milestone "${d.name}"`;
    case 'workspace.created': return `${who} created the workspace "${d.name}"`;
    case 'comment.added': return `${who} commented on ${title}`;
    case 'attachment.added': return `${who} attached ${d.file} to ${title}`;
    default: return `${who} made a change`;
  }
}
