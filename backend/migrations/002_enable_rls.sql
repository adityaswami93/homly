-- Enable RLS on all user data tables
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_analyses ENABLE ROW LEVEL SECURITY;

-- Keep waitlist and articles open (no user-specific data)
-- waitlist is admin-managed, articles are public news

-- chat_history: users can only access their own
CREATE POLICY "chat_history_user_policy"
ON chat_history FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- watchlist: users can only access their own
CREATE POLICY "watchlist_user_policy"
ON watchlist FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- user_preferences: users can only access their own
CREATE POLICY "user_preferences_user_policy"
ON user_preferences FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- earnings_analyses: users can only access their own
CREATE POLICY "earnings_analyses_user_policy"
ON earnings_analyses FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow backend service role to bypass RLS
-- This is automatic for the service role key in Supabase
-- Make sure backend uses SUPABASE_SERVICE_KEY not SUPABASE_ANON_KEY