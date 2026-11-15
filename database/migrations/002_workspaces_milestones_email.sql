-- 002 — workspaces, milestones and the email outbox.
-- Safe on an existing database: every organisation gets a "General" workspace and
-- existing projects are moved into it before the column becomes required.

-- ---------- Workspaces: Organisation → Workspace → Project ----------
CREATE TABLE workspaces (
  id          SERIAL PRIMARY KEY,
  org_id      INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, name)
);

INSERT INTO workspaces (org_id, name, description)
SELECT id, 'General', 'Default workspace' FROM organizations;

ALTER TABLE projects ADD COLUMN workspace_id INT;
UPDATE projects p SET workspace_id = w.id FROM workspaces w WHERE w.org_id = p.org_id AND w.name = 'General';
ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL;
-- A project's workspace must be in the same organisation as the project.
ALTER TABLE projects ADD CONSTRAINT projects_workspace_same_org
  FOREIGN KEY (workspace_id, org_id) REFERENCES workspaces(id, org_id);
CREATE INDEX projects_workspace_idx ON projects (workspace_id);

-- ---------- Milestones: dated checkpoints inside a project ----------
CREATE TABLE milestones (
  id         SERIAL PRIMARY KEY,
  org_id     INT NOT NULL,
  project_id INT NOT NULL,
  name       TEXT NOT NULL,
  due_at     TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, project_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);

ALTER TABLE tasks ADD COLUMN milestone_id INT;
-- A task can only belong to a milestone of its own project.
-- Deleting the milestone clears milestone_id only (PostgreSQL 15+ column-list syntax).
ALTER TABLE tasks ADD CONSTRAINT tasks_milestone_same_project
  FOREIGN KEY (milestone_id, project_id) REFERENCES milestones(id, project_id) ON DELETE SET NULL (milestone_id);

-- ---------- Email outbox ----------
-- Important notifications (assignments, overdue) are also queued as email.
-- With SMTP_URL configured they are sent; without it they are marked 'logged' (written to the server log only).
CREATE TABLE email_outbox (
  id              SERIAL PRIMARY KEY,
  org_id          INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INT REFERENCES notifications(id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'logged', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (status) WHERE status = 'pending';

ALTER TABLE users ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT true;
