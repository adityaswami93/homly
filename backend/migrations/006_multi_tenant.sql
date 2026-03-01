-- Households
CREATE TABLE IF NOT EXISTS households (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  plan         TEXT DEFAULT 'free',
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Household members
CREATE TABLE IF NOT EXISTS household_members (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by   UUID REFERENCES auth.users(id),
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, user_id)
);

-- Super admin flag on users (stored in Supabase user metadata)
-- Set via: UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"is_super_admin": true}' WHERE email = 'your@email.com';

-- Add household_id to existing tables
ALTER TABLE receipts  ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id);
ALTER TABLE items     ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id);
ALTER TABLE settings  ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id);

-- Invites table
CREATE TABLE IF NOT EXISTS invites (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email          TEXT NOT NULL,
  household_id   UUID REFERENCES households(id),  -- null = user creates own household
  role           TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  invited_by     UUID REFERENCES auth.users(id),
  token          TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  accepted       BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- Disable RLS on all tables
ALTER TABLE households        DISABLE ROW LEVEL SECURITY;
ALTER TABLE household_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE invites            DISABLE ROW LEVEL SECURITY;

-- Migrate existing data
-- 1. Create household for existing user
INSERT INTO households (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Home')
ON CONFLICT DO NOTHING;

-- 2. Add existing user as admin (replace with your actual user UUID)
INSERT INTO household_members (household_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id, 'admin'
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;

-- 3. Backfill household_id on all existing data
UPDATE receipts SET household_id = '00000000-0000-0000-0000-000000000001' WHERE household_id IS NULL;
UPDATE items    SET household_id = '00000000-0000-0000-0000-000000000001' WHERE household_id IS NULL;
UPDATE settings SET household_id = '00000000-0000-0000-0000-000000000001' WHERE household_id IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_receipts_household  ON receipts(household_id);
CREATE INDEX IF NOT EXISTS idx_items_household     ON items(household_id);
CREATE INDEX IF NOT EXISTS idx_members_household   ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_members_user        ON household_members(user_id);
