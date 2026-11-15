# Metric definitions

Every number on the Reports page follows these rules. Each tile on the page shows its numerator and denominator.

## Terms

- **Counted task**: a top-level task (not a subtask or checklist step), not archived, in a project whose status is `active`. Subtasks are excluded so that splitting work into steps does not inflate completion.
- **Open task**: a counted task whose status is not `done`.
- **Scope**: the whole organisation, one workspace (every project in it), or one project.
- **Time window**: `from` to `to` (the default is the last 30 days). Some metrics use it and some describe the present moment; each says which.
- **Time zone**: every timestamp is stored as `timestamptz` (UTC) and compared in UTC. A date-only due date chosen in the browser is stored as 23:59 local time on that day.
- **No data**: when a denominator is 0 the API returns `value: null` and the page shows "—". It never shows 0% or NaN.

## Formulas

| Metric | Formula | Uses the window? |
|---|---|---|
| Task completion rate | counted tasks *created in the window* with status `done` ÷ counted tasks created in the window | Yes, by `created_at` |
| On-time completion rate | tasks finished in the window with `completed_at <= due_at` ÷ tasks finished in the window that had a due date | Yes, by `completed_at` |
| Overdue task count | open tasks with `due_at < now()` | No, it is right now |
| Project progress | counted tasks with status `done` ÷ all counted tasks in the project | No |
| Weighted progress | sum of weights of done counted tasks ÷ sum of weights of all counted tasks, where urgent = 4, high = 3, medium = 2, low = 1 | No |
| Milestone progress | done counted tasks linked to the milestone ÷ counted tasks linked to it | No |
| Assignment coverage | open tasks with an assignee ÷ all open tasks | No |
| Status distribution | count of counted tasks per status | No |
| Workload (per person) | open tasks assigned, overdue tasks assigned, tasks finished in the window | Partly (finished only) |
| Weekly trend | per ISO week (Monday start, UTC), for the 8 weeks ending at `to`: counted tasks created, and counted tasks finished | Yes |
| Notification processing | in-app notifications created in the window and how many were read; emails queued in the window split into **sent** (delivered by SMTP), **logged** (SMTP not configured, written to the log only), **failed** (3 attempts failed) and **pending** | Yes |

## How `completed_at` is kept honest

- Moving a task to `done` sets `completed_at = now()`, but only if it was not already done, so re-saving does not reset the date.
- Moving it out of `done` clears `completed_at`.
- These rules live in the API (`PATCH /tasks/:id`), not the UI, so every client follows them.

## Verification

`tests/roles-and-tasks.test.ts` recomputes overdue count, assignment coverage and status totals with independent SQL and compares them to the API output. It also checks that empty windows return `null` rather than 0.

## Where the formulas appear in the app

- **Reports**: every tile shows "x of y" and its formula, and the page ends with *How each number is calculated*.
- **Project → Overview**: progress and weighted progress show their formula under the number; each milestone shows "x of y tasks done".
