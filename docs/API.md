# API reference

JSON over HTTPS. Authentication is a session cookie set by `/api/auth/login` or `/api/auth/register`.
Errors always look like `{ "error": "Human readable message", "details": { "field": "problem" } }`.

| Status | Meaning |
|---|---|
| 400 | Input failed validation (`details` names the fields) |
| 401 | Not signed in, or session expired |
| 403 | Signed in and in the org, but your role cannot do this |
| 404 | Does not exist **or belongs to another organisation** (deliberately the same answer) |
| 409 | Conflict: someone else edited this task first (`details.current` has their version), or a duplicate |
| 413 / 415 | Upload too large / file type not allowed |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `name, email, password (8+), orgName` | Creates the user, a new org, and makes them owner |
| POST | `/api/auth/login` | `email, password` | Rate limited to 20 per 15 minutes |
| POST | `/api/auth/logout` | – | |
| PATCH | `/api/auth/me` | `emailNotifications` | Turn emails on or off for yourself |
| GET | `/api/auth/me` | – | `{ user, orgs: [{id, name, role}] }`, or `{ user: null }` when signed out |

## Organisation (all under `/api/orgs/:orgId`, membership required)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/` | any member | Org name and your role |
| GET | `/members` | any member | Includes open-task count per person |
| POST | `/members` | owner | `{ email, role }` — person must have signed up |
| PATCH | `/members/:userId` | owner | `{ role }` — last owner is protected |
| DELETE | `/members/:userId` | owner | Unassigns their open tasks |
| GET | `/workspaces` | any member | With the number of projects you can see in each |
| POST | `/workspaces` | owner, manager | `{ name, description? }` |
| PATCH | `/workspaces/:id` | owner, manager | `{ name?, description? }` |
| DELETE | `/workspaces/:id` | owner | Only when it holds no projects (409 otherwise) |
| GET / POST | `/teams` | any / owner, manager | `{ name, memberIds[] }` |
| DELETE | `/teams/:teamId` | owner, manager | |
| GET | `/my-work` | any member | `{ overdue[], upcoming[], later[] }` |
| GET | `/notifications` | any member | Latest 100, plus unread count |
| GET | `/notifications/unread-count` | any member | |
| POST | `/notifications/:id/read`, `/notifications/read-all` | any member | Only your own |

## Projects

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/projects?archived=1&workspace=<id>` | any member | Employees see only projects they belong to |
| POST | `/projects` | owner, manager | `{ name, description, workspaceId?, teamId?, memberIds[] }` (default: first workspace) |
| GET | `/projects/:id` | project viewers | Project, workspace, members, labels, milestones with progress, stats (progress and weighted progress), `canManage` |
| PATCH | `/projects/:id` | owner, manager | `{ name?, description?, status?, workspaceId? }` |
| POST | `/projects/:id/milestones` | owner, manager | `{ name, dueAt? }` |
| PATCH / DELETE | `/projects/:id/milestones/:milestoneId` | owner, manager | Deleting keeps the tasks and clears their milestone |
| POST / DELETE | `/projects/:id/members[/:userId]` | owner, manager | |
| POST | `/projects/:id/labels` | project viewers | `{ name, color }` |
| GET | `/projects/:id/tasks?q=&assignee=me|none|<id>&priority=&label=&milestone=<id>|none&overdue=1` | project viewers | Top-level tasks with counts and labels |
| POST | `/projects/:id/tasks` | project viewers | `{ title, description?, status?, priority?, assigneeId?, dueAt?, parentId?, labelIds?, milestoneId? }` |
| GET | `/projects/:id/activity` | project viewers | Latest 80 events |

## Tasks

| Method | Path | Notes |
|---|---|---|
| GET | `/tasks/:id` | Task, parent, subtasks, comments, attachments, history |
| PATCH | `/tasks/:id` | Any of `title, description, status, priority, assigneeId, dueAt, position, labelIds, milestoneId`, plus `version` for conflict detection |
| DELETE | `/tasks/:id` | Archives the task and its subtasks (creator or manager) |
| POST | `/tasks/:id/restore` | Undo an archive (creator or manager) |
| POST | `/tasks/:id/comments` | `{ body }` |
| DELETE | `/tasks/:id/comments/:commentId` | Author or manager |
| POST | `/tasks/:id/attachments` | `multipart/form-data`, field `file`, max 5 MB, allow-listed types |
| GET | `/tasks/:id/attachments/:attachmentId` | Download (always `Content-Disposition: attachment`) |
| DELETE | `/tasks/:id/attachments/:attachmentId` | Uploader or manager |

## Reports

| Method | Path | Who |
|---|---|---|
| GET | `/reports?from=ISO&to=ISO&projectId=` or `&workspaceId=` | owner, manager |

See [METRICS.md](METRICS.md) for the formulas.

## Other

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok, db }` — used by the host's health check |
| POST | `/api/client-errors` | Browser error reports, written to the server log. Rate limited (30 per minute) |

Every response has an `X-Request-Id` header. A 500 error message includes the same id, which also appears in the server log.
