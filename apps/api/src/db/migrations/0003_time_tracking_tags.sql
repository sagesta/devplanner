-- Feature 1: Time Tracking Engine
CREATE TABLE IF NOT EXISTS task_time_logs (
  id               SERIAL PRIMARY KEY,
  task_id          UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER GENERATED ALWAYS AS (
                     EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
                   ) STORED,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_time_logs_task_idx ON task_time_logs (task_id);
CREATE INDEX IF NOT EXISTS task_time_logs_active_idx ON task_time_logs (ended_at) WHERE ended_at IS NULL;

-- Feature 5: Global Tags System
CREATE TABLE IF NOT EXISTS tags (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(50) UNIQUE NOT NULL,
  color      VARCHAR(7) DEFAULT '#6B7280',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  INT  REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Feature 3: Weekly Hour Targets per Area
ALTER TABLE areas ADD COLUMN IF NOT EXISTS weekly_hour_target NUMERIC(5,1) DEFAULT NULL;
