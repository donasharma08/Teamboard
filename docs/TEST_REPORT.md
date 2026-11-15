# Test report

Generated 2026-11-15 14:09 UTC by `npm run test:report`.
Environment: Node v22.23.4, Linux 6.18.44-fc-v470 (x64).

## Summary

| Suite | Passed | Failed | Total |
|---|---|---|---|
| API, integration and unit (Vitest) | 66 | 0 | 66 |
| Browser end-to-end (Playwright) | 9 | 0 | 9 |

## API, integration and unit tests (Vitest)

### tests/features.test.ts

| Result | Test | Time |
|---|---|---|
| ✅ | workspaces › lists only your organisation’s workspaces, with project counts you are allowed to see | 15 ms |
| ✅ | workspaces › managers create workspaces and put projects in them; employees cannot | 22 ms |
| ✅ | workspaces › a workspace that still has projects cannot be deleted | 4 ms |
| ✅ | workspaces › another organisation’s workspace cannot be used, renamed or deleted | 15 ms |
| ✅ | milestones › appear on the project with their own progress | 8 ms |
| ✅ | milestones › a task can only join a milestone of its own project | 7 ms |
| ✅ | milestones › the database refuses a cross-project milestone even if the API were bypassed | 3 ms |
| ✅ | milestones › deleting a milestone keeps its tasks | 18 ms |
| ✅ | milestones › employees cannot create milestones; outsiders cannot see them | 6 ms |
| ✅ | weighted progress › weights urgent 4, high 3, medium 2, low 1 and matches a hand count | 22 ms |
| ✅ | email channel › queues email only for assignments and overdue work, never for comments | 18 ms |
| ✅ | email channel › respects the person’s email preference | 31 ms |
| ✅ | email channel › the overdue scan does not queue duplicate emails | 3 ms |
| ✅ | email channel › without SMTP_URL, emails are marked "logged" (not delivered) and reported separately | 13 ms |
| ✅ | reports by workspace › limits every number to the projects in that workspace | 11 ms |
| ✅ | error logging › every response carries a request id | 2 ms |
| ✅ | error logging › browser errors are accepted and written to the log file | 2 ms |
| ✅ | migration 002 on an existing database › creates a General workspace per organisation and moves existing projects into it | 1519 ms |

### tests/isolation.test.ts

| Result | Test | Time |
|---|---|---|
| ✅ | an outsider using the other org id in the URL › gets 404 on every read | 45 ms |
| ✅ | an outsider using the other org id in the URL › gets 404 on every write, and nothing changes | 29 ms |
| ✅ | an outsider using their OWN org id with the other org's record ids › cannot reach Saffron projects, tasks or files through /orgs/Banyan/... | 34 ms |
| ✅ | an outsider using their OWN org id with the other org's record ids › cannot assign a Saffron person to Banyan work or add them to a Banyan project | 21 ms |
| ✅ | an outsider using their OWN org id with the other org's record ids › only ever sees Banyan rows in list endpoints | 29 ms |
| ✅ | and the other way round › Saffron's owner cannot read Banyan's confidential task | 15 ms |
| ✅ | the database itself refuses cross-org links › a task cannot point at a project in another org (composite foreign key) | 3 ms |
| ✅ | the database itself refuses cross-org links › a comment cannot point at a task in another org | 2 ms |
| ✅ | signed-out visitors › get 401 everywhere | 4 ms |

### tests/roles-and-tasks.test.ts

| Result | Test | Time |
|---|---|---|
| ✅ | authentication › gives the same answer for a wrong email and a wrong password | 104 ms |
| ✅ | authentication › sets an httpOnly, SameSite=Lax session cookie | 112 ms |
| ✅ | authentication › registers a new person as owner of a new org, and never returns the password hash | 114 ms |
| ✅ | authentication › explains validation problems field by field | 6 ms |
| ✅ | roles › employees only see projects they belong to | 18 ms |
| ✅ | roles › employees do not see tasks from hidden projects in 'my work' either | 5 ms |
| ✅ | roles › managers see every project | 5 ms |
| ✅ | roles › employees cannot create projects, open reports, or manage people | 11 ms |
| ✅ | roles › managers cannot change roles; only owners can | 3 ms |
| ✅ | roles › the last owner cannot be demoted or removed | 8 ms |
| ✅ | roles › employees can only archive tasks they created | 24 ms |
| ✅ | roles › work can only be assigned to people on the project | 5 ms |
| ✅ | task lifecycle › rejects a stale edit with 409 instead of silently overwriting (two people editing at once) | 15 ms |
| ✅ | task lifecycle › stamps completed_at when done, clears it when reopened | 14 ms |
| ✅ | task lifecycle › subtasks cannot have subtasks | 4 ms |
| ✅ | task lifecycle › validates input on the server | 10 ms |
| ✅ | notifications › tells the assignee, not the person who assigned | 8 ms |
| ✅ | notifications › does not notify you about your own comment | 8 ms |
| ✅ | notifications › the overdue scan does not create duplicates when it runs again | 4 ms |
| ✅ | notifications › you can only mark your own notifications read | 6 ms |
| ✅ | attachments › accepts an allowed file and lets project members download it | 26 ms |
| ✅ | attachments › rejects disallowed types, including a renamed extension | 11 ms |
| ✅ | attachments › rejects files over 5 MB | 56 ms |
| ✅ | attachments › employees outside the project cannot download it | 21 ms |
| ✅ | reports › numbers match a direct count of the database | 27 ms |
| ✅ | reports › returns null (not 0% or NaN) when there is nothing to divide by | 14 ms |
| ✅ | reports › rejects a backwards date range | 4 ms |

### tests/unit.test.ts

| Result | Test | Time |
|---|---|---|
| ✅ | positionBetween (card ordering) › puts a card between two neighbours without renumbering | 2 ms |
| ✅ | positionBetween (card ordering) › handles the top, the bottom and an empty column | 0 ms |
| ✅ | positionBetween (card ordering) › keeps order after many inserts at the same spot | 1 ms |
| ✅ | dueLabel (dates as people say them) › says today, tomorrow, and days late | 2 ms |
| ✅ | dueLabel (dates as people say them) › does not call finished work late | 22 ms |
| ✅ | date input round trip › a picked date means the end of that day, local time | 0 ms |
| ✅ | small formatters › formats percentages and empty values | 0 ms |
| ✅ | small formatters › formats file sizes | 0 ms |
| ✅ | small formatters › says "just now" and "yesterday" | 1 ms |
| ✅ | activity sentences › turns events into plain sentences | 0 ms |
| ✅ | server input helpers › parse() returns clean data or a 400 that names each bad field | 5 ms |
| ✅ | server input helpers › idParam() turns anything that is not a positive whole number into 404 | 0 ms |

## Browser tests (Playwright, Chromium)

| Result | Test | Time |
|---|---|---|
| ✅ | journeys.spec.ts › a manager moves a card across the board with only the keyboard | 1373 ms |
| ✅ | journeys.spec.ts › a task can be created, commented on and finished | 1445 ms |
| ✅ | journeys.spec.ts › an employee cannot see a project she is not on, even by typing the URL | 716 ms |
| ✅ | journeys.spec.ts › one company cannot open the other company's workspace | 646 ms |
| ✅ | responsive.spec.ts › no sideways page scroll at 375px | 4117 ms |
| ✅ | responsive.spec.ts › no sideways page scroll at 768px | 4197 ms |
| ✅ | responsive.spec.ts › no sideways page scroll at 1024px | 4097 ms |
| ✅ | responsive.spec.ts › no sideways page scroll at 1440px | 4095 ms |
| ✅ | responsive.spec.ts › reports explain every number, and the project overview shows milestones | 849 ms |
