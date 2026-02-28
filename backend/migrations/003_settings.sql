CREATE TABLE IF NOT EXISTS settings (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  summary_day INT DEFAULT 6,        -- 0=Monday, 6=Sunday (cron day: 0=Sunday so we convert)
  summary_hour INT DEFAULT 9,       -- 24hr UTC hour
  summary_timezone TEXT DEFAULT 'Asia/Singapore',
  cutoff_mode TEXT DEFAULT 'last7days' CHECK (cutoff_mode IN ('last7days', 'isoweek')),
  group_name  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
