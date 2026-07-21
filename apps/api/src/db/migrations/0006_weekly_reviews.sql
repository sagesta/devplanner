CREATE TABLE IF NOT EXISTS weekly_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start   DATE NOT NULL,
  week_end     DATE NOT NULL,
  wins         TEXT NOT NULL DEFAULT '',
  carryover    TEXT NOT NULL DEFAULT '',
  intentions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sprint_notes TEXT NOT NULL DEFAULT '',
  sprint_id    UUID REFERENCES sprints(id) ON DELETE SET NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'draft',
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_reviews_user_week_uidx
  ON weekly_reviews (user_id, week_start);

CREATE INDEX IF NOT EXISTS weekly_reviews_user_week_idx
  ON weekly_reviews (user_id, week_start);
