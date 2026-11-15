# Final report — TeamBoard

Project 2: Project Management & Team Collaboration SaaS

## 1. What was built

A multi-tenant web app where organisations group their work into workspaces and projects, plan with milestones, run tasks on a Kanban board, discuss them, attach files, get notified, and see how the work is going. Two synthetic organisations ship with the app so tenant isolation can be shown live.

| Area | Delivered |
|---|---|
| Structure | Organisations → workspaces → projects; teams; memberships with three roles |
| Tasks | Status, priority, assignee, due date, labels, milestone, subtasks, soft delete with Undo |
| Board | Drag and drop, full keyboard control, "Move to…" menu, screen-reader announcements, filters |
| Collaboration | Comments, validated file attachments, per-task and per-project history |
| Notifications | In-app for assignments, comments, status and date changes, overdue work; email for assignments and overdue work |
| Reports | Completion, on-time, overdue, assignment coverage, progress, weighted progress, status mix, weekly trend, workload, notification delivery — each with its formula on screen |
| Quality | 66 API/integration/unit tests, 9 browser tests, saved test report, structured error logs |

## 2. Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| **Org id in every URL** (`/api/orgs/:orgId/...`) plus a membership check in one middleware | Isolation is enforced in one place and is easy to audit and test | Slightly longer URLs |
| **404, not 403, for other organisations' data** | A 403 would confirm the record exists | Error messages are less specific for outsiders (on purpose) |
| **Composite foreign keys** on `(id, org_id)` | A bug in the code still cannot link data across organisations — the database refuses | More complex keys and joins |
| **PGlite** for local runs | Real PostgreSQL with zero install; the same SQL runs on hosted Postgres via `DATABASE_URL` | Handles one query at a time; fine for demos, not for production traffic |
| **Optimistic concurrency** (`version` column) | Two people editing the same task never silently overwrite each other | The second person must re-apply their change (the screen reloads the latest version) |
| **Polling** every 10–15 s instead of WebSockets | Simple and reliable; allowed by the brief if documented | Changes by others appear after a short delay |
| **Decimal card positions** | A drop costs one row update, not renumbering a column | Positions can get very close after thousands of drops (would need occasional rebalancing) |
| **Email only for assignments and overdue work** | Keeps inboxes quiet; the brief asks to avoid noisy notifications | Comment emails are not available |
| **Email outbox table + worker** | A failed send never breaks the user's action; retries are possible; delivery is measurable | Up to one minute delay before sending |
| **Metrics count top-level tasks only** | Splitting a task into steps should not inflate progress | Subtask progress shows only as the checklist count on the card |
| **Weighted progress by priority** | An urgent finished task should count for more than a low one | Weights are fixed (4/3/2/1), not user-set |
| **Undo instead of "Are you sure?"** | Faster and friendlier; nothing is hard-deleted | Needs soft delete everywhere |

## 3. Security controls

| Threat | Control |
|---|---|
| Reading or changing another organisation's data | Org-scoped middleware, scoped queries, composite foreign keys, 404 for outsiders; proved by `tests/isolation.test.ts` |
| Employees exceeding their role | Role checks in every route; permission matrix shown in the app and in the README; tested |
| Stolen sessions (XSS) | Session token in an `httpOnly` cookie that JavaScript cannot read; strict Content-Security-Policy via helmet |
| Cross-site request forgery | `SameSite=Lax` cookie, so it is not sent on cross-site POSTs |
| Password theft | bcrypt hashing; same error for wrong email or wrong password; 20 login attempts per 15 minutes |
| SQL injection | Parameterised queries everywhere; ids validated as positive integers |
| Bad input | zod validation on every request body, with field-level messages |
| Malicious uploads | 5 MB limit, allow-list of type and extension pairs, random server-side file names, always served as a download, permission checked before any bytes are accepted |
| Leaking secrets | Secrets only in environment variables; `.env.example` holds none; production generates a random session key if none is set |
| Silent failures | Request id on every response; JSON error logs with user, org, path and stack; browser errors reported to the same log |

## 4. Testing

| Suite | Count | Covers |
|---|---|---|
| Unit (`tests/unit.test.ts`) | 12 | Card ordering, date wording, input validation helpers, activity sentences |
| API and integration (`tests/isolation`, `roles-and-tasks`, `features`) | 54 | Isolation, roles, auth, concurrency, validation, notifications, email, uploads, reports, workspaces, milestones, logging, migration upgrade |
| Browser (`tests-e2e/`) | 9 | Keyboard moves, create–comment–finish, hidden projects, cross-org block, no sideways scroll at 375/768/1024/1440 px, formulas and milestones on screen |

`npm run test:report` runs everything and writes `docs/TEST_REPORT.md`.

## 5. Known gaps

- **Not deployed by default.** `render.yaml` and the README guide make it a few clicks, but a free host without a persistent disk resets PGlite data and uploaded files on restart. Use a hosted Postgres (`DATABASE_URL`) to keep data.
- **Email is not delivered without SMTP.** With no `SMTP_URL`, emails are marked "logged" and written to the server log. The Reports page counts delivered, logged and failed separately.
- **No real-time push.** Polling only.
- **No invitations.** A person must sign up before an owner can add them.
- **Files on local disk.** Production should use object storage (S3, R2).
- **One level of subtasks**, and no "cancelled" status (archived tasks are excluded instead).
- **Weights for weighted progress are fixed**, not configurable per project.
- **Overdue alerts are checked every 5 minutes**, so an alert can lag the deadline slightly.

## 6. Future improvements

1. WebSockets or Server-Sent Events for live board updates.
2. Email invitations with expiring links.
3. Object storage for attachments, with virus scanning.
4. Per-project custom statuses and configurable weights.
5. Burndown chart per milestone.
6. Audit log export and organisation-level data export.
7. Postgres row-level security as a third isolation layer, in addition to the middleware and composite keys.
