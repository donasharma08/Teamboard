# TeamBoard

A multi-tenant project management and team collaboration app. Organisations, workspaces, teams, projects, milestones, a drag-and-drop Kanban board, subtasks, comments, file attachments, activity history, in-app and email notifications, overdue alerts, role-based access, and productivity reports with their formulas shown on screen.

Built for Project 2: Project Management & Team Collaboration SaaS (Web Development Internship).

---

## Run it (2 commands)

You only need Node.js 20 or newer. No database to install, no Docker, no `.env` file.

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and click one of the demo people on the sign-in page.

The first start creates the database and fills it with demo data. Every demo password is `password123`.

| Person | Organisation | Role | What to show with them |
|---|---|---|---|
| Asha Rao — `asha@saffron.test` | Saffron Studio | Owner | Everything, including people and roles |
| Kabir Mehta — `kabir@saffron.test` | Saffron Studio | Manager | All projects and reports |
| Meera Iyer — `meera@saffron.test` | Saffron Studio | Employee | Sees only *Website relaunch*, no reports |
| Rohan Das — `rohan@saffron.test` | Saffron Studio | Employee | On both projects |
| Vikram Shah — `vikram@banyan.test` | Banyan Logistics | Owner | **A different company.** Cannot see any Saffron data |
| Neha Kulkarni — `neha@banyan.test` | Banyan Logistics | Employee | |

To wipe everything and reload the demo data: `npm run seed`.

### How there is no database to install

The app uses **[PGlite](https://pglite.dev)**, which is real PostgreSQL compiled to WebAssembly and running inside the Node process. Data is saved in `./.data/pglite`. It is the same SQL dialect, so if you set `DATABASE_URL` to any hosted PostgreSQL (for example a free [Neon](https://neon.tech) database), the same code and migrations run there unchanged.

---

## Screenshots

| | |
|---|---|
| ![Board](docs/screenshots/board.png) | ![Task](docs/screenshots/task.png) |
| ![My work](docs/screenshots/my-work.png) | ![Reports](docs/screenshots/reports.png) |
| ![Another organisation is blocked](docs/screenshots/other-org-blocked.png) | ![Mobile](docs/screenshots/mobile-board.png) |

---

## What it does

| Area | Features |
|---|---|
| **Organisations** | Sign up creates an org with you as owner. Owners add people by email and set roles. One person can belong to several orgs (switcher in the sidebar). Teams group people and can be attached to a project. A permission table on the People page shows who can do what. |
| **Workspaces** | Organisation → Workspace → Project. The Projects page is grouped by workspace; managers create workspaces and move projects between them. |
| **Projects** | Create, edit, archive and restore projects. Add or remove members. The **Overview** tab shows progress, weighted progress, late work, **milestones** with their own progress, and the people on the project. |
| **Milestones** | Dated checkpoints inside a project ("Content ready", "Launch"). Link tasks to them; click a milestone to see just its tasks on the board. |
| **Tasks** | Title, notes, status, priority, assignee, due date, labels, subtasks (a checklist), soft delete with **Undo**. |
| **Kanban board** | Four columns. Drag with a mouse or touch. **Keyboard**: focus a card, `Space` to lift, arrow keys to move between and within columns, `Space` to drop, `Esc` to cancel, `Enter` to open. Every card also has a "Move to…" menu as a non-drag alternative. Screen-reader announcements describe each move. |
| **Collaboration** | Comments, file attachments (type and size checked, downloads checked against permissions), full activity history per task and per project. |
| **Notifications** | In-app notifications for assignments, comments, status changes, due-date changes, and overdue work. **Email** for assignments and overdue work only (each person can switch it off). You are never notified about your own actions, and the overdue check never sends the same alert twice. |
| **My work** | Your open tasks grouped into *running late*, *due in the next 7 days*, and *later*, with one-click completion. |
| **Reports** | Completion rate, on-time rate, overdue count, assignment coverage, progress, **weighted progress**, status breakdown, weekly trend, workload per person, progress per project, and notification delivery (in-app vs email). Filter by organisation, workspace or project and by time window. Every tile shows its numerator, denominator and formula, and a **How each number is calculated** section explains each one. |
| **Concurrent edits** | Each task has a `version`. If two people edit the same task, the second save gets `409 Conflict` and the screen reloads the latest version, so nobody's change is silently lost. |

---

## Multi-tenant isolation (how one company is kept out of another's data)

This is the most important property of the app and the one the evaluation asks you to prove. It is enforced in three layers:

1. **Every tenant URL contains the org id.** All data routes live under `/api/orgs/:orgId/...`.
2. **`orgScope` middleware** ([server/lib/scope.ts](server/lib/scope.ts)) checks that the signed-in user is a member of that org before any route runs. If not, it answers **404, not 403**, so an outsider cannot even confirm the org exists.
3. **Every query filters by `org_id` and project visibility.** `getProject()` and `getTask()` look up records with `WHERE id = $1 AND org_id = $2 AND <user can see this project>`. An id that belongs to another org simply "does not exist" here.

The database adds a fourth safety net: **composite foreign keys**. `tasks (project_id, org_id)` references `projects (id, org_id)`, and comments and attachments do the same against tasks. So even a bug in the code could not make a task point at another org's project. Postgres would reject it.

**Proof:** `tests/isolation.test.ts` signs in as Banyan's owner and tries every read and write against Saffron's projects, tasks, comments, files, members and reports, both through Saffron's org id and by putting Saffron's record ids under Banyan's org id. Every attempt returns 404 and the database is checked afterwards to confirm nothing changed.

---

## Roles and permissions

Checked on the server in middleware and route handlers. The interface hides what you cannot do, but it is never the only check.

| Action | Owner | Manager | Employee |
|---|:-:|:-:|:-:|
| See all projects in the org | ✓ | ✓ | only projects they are a member of |
| Create / archive projects, manage project members | ✓ | ✓ | – |
| Create workspaces and milestones | ✓ | ✓ | – |
| Delete an empty workspace | ✓ | – | – |
| Create and edit tasks, comment, attach files | ✓ | ✓ | ✓ (in their projects) |
| Remove (archive) a task | ✓ | ✓ | only tasks they created |
| Delete a comment / file | ✓ | ✓ | only their own |
| See reports | ✓ | ✓ | – |
| Add people to the org, change roles, remove people | ✓ | – | – |
| Create teams | ✓ | ✓ | – |

Guard rails: the last owner cannot be demoted or removed. When someone leaves an org or a project, their unfinished tasks become unassigned. Work can only be assigned to people on that project.

---

## Tests

```bash
npm test             # 66 unit, API and integration tests, ~10 seconds, no setup
npm run test:e2e     # 9 browser tests (Playwright). First time only: npx playwright install chromium
npm run test:report  # runs both and writes docs/TEST_REPORT.md
```

| File | What it proves |
|---|---|
| `tests/isolation.test.ts` | Cross-org reads and writes are blocked and change nothing. The database rejects cross-org foreign keys. Signed-out visitors get 401. |
| `tests/roles-and-tasks.test.ts` | Auth (bcrypt, httpOnly cookie, identical error for wrong email or password), every role rule above, version conflicts (409), completed-at rules, input validation, notification rules (no self-notify, no duplicate overdue alerts), upload type and size limits, download permissions, and report numbers checked against direct SQL counts. |
| `tests/features.test.ts` | Workspaces and milestones (including cross-org and cross-project blocks), weighted progress against a hand count, the email channel (only the right events, respects the opt-out, no duplicates, "logged" without SMTP), workspace-scoped reports, request ids and log files, and upgrading an old database with migration 002. |
| `tests/unit.test.ts` | Pure functions: card ordering, date wording, date input round trip, formatters, activity sentences, input validation helpers. |
| `tests-e2e/responsive.spec.ts` | No sideways page scroll at 375, 768, 1024 and 1440 px on every main page; formulas and milestones visible. |
| `tests-e2e/journeys.spec.ts` | In a real browser: keyboard-only card moves are saved; create, comment and finish a task; an employee cannot open a hidden project by URL; one company cannot open another's workspace. |

Each test file starts a fresh in-memory PostgreSQL, so tests never touch your dev data.

---


## Configuration

All optional in development. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(empty → PGlite)* | Hosted PostgreSQL connection string |
| `JWT_SECRET` | dev value; random in production | Signs session cookies. **Set it in production**, or everyone is signed out on each restart |
| `PORT` | `3000` | API port |
| `SEED_ON_EMPTY` | `1` | Load demo data into an empty database |
| `UPLOAD_DIR` | `storage/uploads` | Where attachments are stored (git-ignored) |
| `SMTP_URL` | *(empty)* | e.g. `smtps://user:pass@smtp.example.com`. Empty means emails are written to the log, not sent |
| `EMAIL_FROM` | `TeamBoard <no-reply@teamboard.local>` | Sender address for emails |
| `LOG_DIR` | `storage/logs` | Warnings and errors are appended to `app.log` here (every log line also goes to stdout as JSON) |

---

## Architecture

```
Browser (React + TypeScript, Vite)
   │  fetch /api/...  (same origin, httpOnly session cookie)
   ▼
Express 5 API (TypeScript, run with tsx)
   ├─ requireAuth   → verifies the JWT cookie, loads the user
   ├─ orgScope      → membership check for /api/orgs/:orgId (404 if not a member)
   ├─ routes        → projects, tasks, comments, attachments, notifications, reports
   └─ zod           → validates every request body on the server
   ▼
PostgreSQL (PGlite in-process, or any Postgres via DATABASE_URL)
```

```
client/            React app (pages, components, design tokens in styles.css)
server/            Express API
  lib/scope.ts     org scoping and visibility rules (start here)
  lib/events.ts    activity log, notifications, overdue scan
  routes/          one file per resource
database/
  migrations/      plain SQL, applied in order at startup
  seed/            synthetic demo data (two organisations)
tests/             API and integration tests (Vitest + Supertest)
tests-e2e/         browser tests (Playwright)
docs/              API reference, metric definitions, design notes, demo script
```

**Logging:** every response has an `X-Request-Id`. Server errors are logged as JSON (request id, user, org, path, stack) to stdout and `storage/logs/app.log`; the user sees the same reference id. Browser errors are sent to `/api/client-errors` and land in the same log.

**Security controls:** bcrypt password hashing; JWT in an `httpOnly`, `SameSite=Lax` cookie (not readable by JavaScript, not sent on cross-site POSTs) with an 8-hour expiry; login rate limit (20 per 15 minutes); helmet security headers with a strict Content-Security-Policy; parameterised SQL everywhere; zod validation on every input; 100 KB JSON body limit; uploads limited to 5 MB and an allow-list of type and extension pairs, stored under random server-generated names, always served as downloads, and permission-checked before any bytes are accepted.

---

## Known limitations

Stated plainly, as the brief asks:

- **Email needs SMTP.** Without `SMTP_URL`, emails are marked "logged" and written to the server log instead of being sent. Reports count delivered, logged and failed emails separately.
- **Updates arrive by polling, not real time.** The board refreshes every 10 seconds and the notification badge every 15 seconds, only while the tab is visible. The brief allows polling if it is documented. Version checks stop stale edits from overwriting newer ones.
- **No invitation emails.** A person must sign up before an owner can add them by email.
- **Attachments are stored on local disk.** On hosts without a persistent disk they are lost on restart. Production would use object storage (S3 or R2).
- **Overdue is checked every 5 minutes** and compared in UTC. A date-only due date means 23:59 local time on that day.
- **"Cancelled" is not a separate status.** Removed (archived) tasks are left out of every metric.
- **PGlite handles one query at a time.** That is fine for a demo and development. Use `DATABASE_URL` with a hosted Postgres for real traffic.

## Documents

| File | Contents |
|---|---|
| [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md) | Design decisions, security controls, testing, known gaps, future improvements |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | ER diagram and the rules the database enforces |
| [docs/WIREFRAMES.md](docs/WIREFRAMES.md) | Low-fidelity wireframes of the seven pages |
| [docs/METRICS.md](docs/METRICS.md) | Exact formula for every number |
| [docs/API.md](docs/API.md) | Every endpoint |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | Latest test results (`npm run test:report`) |
