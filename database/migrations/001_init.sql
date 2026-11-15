-- 001_init.sql — core schema for TeamBoard
-- All timestamps are timestamptz and stored in UTC.
-- Every organisation-owned row carries org_id, and composite foreign keys
-- guarantee a child row can never point at a parent in a different organisation.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- A team is a named group of people inside an organisation (e.g. "Design").
CREATE TABLE teams (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE TABLE team_members (
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE projects (
  id          SERIAL PRIMARY KEY,
  org_id      INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id     INT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (team_id, org_id) REFERENCES teams(id, org_id)
);

CREATE TABLE project_members (
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE tasks (
  id           SERIAL PRIMARY KEY,
  org_id       INT NOT NULL,
  project_id   INT NOT NULL,
  parent_id    INT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id  INT REFERENCES users(id) ON DELETE SET NULL,
  due_at       TIMESTAMPTZ,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived     BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  version      INT NOT NULL DEFAULT 1,
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, org_id) REFERENCES tasks(id, org_id) ON DELETE CASCADE
);
CREATE INDEX tasks_project_idx ON tasks (project_id, status, position);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id) WHERE archived = false;

CREATE TABLE labels (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL,
  project_id INT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'sage',
  UNIQUE (project_id, name),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);

CREATE TABLE task_labels (
  task_id  INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id INT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE comments (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL,
  task_id    INT NOT NULL,
  author_id  INT REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, org_id) REFERENCES tasks(id, org_id) ON DELETE CASCADE
);

CREATE TABLE attachments (
  id            SERIAL PRIMARY KEY,
  org_id        INT NOT NULL,
  task_id       INT NOT NULL,
  uploader_id   INT REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL,
  size_bytes    INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, org_id) REFERENCES tasks(id, org_id) ON DELETE CASCADE
);

CREATE TABLE activity_events (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id INT,
  task_id    INT,
  actor_id   INT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_project_idx ON activity_events (project_id, created_at DESC);
CREATE INDEX activity_task_idx ON activity_events (task_id, created_at DESC);

CREATE TABLE notifications (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('assigned', 'comment', 'due_changed', 'overdue', 'status')),
  task_id    INT,
  project_id INT,
  message    TEXT NOT NULL,
  -- dedupe_key stops the same alert being created twice (e.g. the overdue scan running every few minutes)
  dedupe_key TEXT UNIQUE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, org_id, read_at, created_at DESC);
