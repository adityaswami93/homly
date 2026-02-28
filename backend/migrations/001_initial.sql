-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Articles table for news ingestion
CREATE TABLE IF NOT EXISTS articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  url TEXT UNIQUE NOT NULL,
  source TEXT,
  published_at TIMESTAMPTZ,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION match_articles(
  query_embedding vector(1536),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  content TEXT,
  url TEXT,
  source TEXT,
  published_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql
AS $$
  SELECT
    id, title, description, content, url, source, published_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM articles
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Chat history per user
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlist per user
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('stock', 'sgx', 'crypto', 'topic')),
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- User preferences for digest
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  digest_enabled BOOLEAN DEFAULT true,
  digest_time TEXT DEFAULT '07:00',
  digest_frequency TEXT DEFAULT 'daily',
  topics TEXT[] DEFAULT ARRAY['global markets', 'Singapore economy', 'Federal Reserve', 'inflation'],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Waitlist for new signups
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helper function to get user emails from auth.users
CREATE OR REPLACE FUNCTION get_user_emails()
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT id, email FROM auth.users;
$$;

CREATE TABLE IF NOT EXISTS earnings_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT,
  analysis JSONB,
  transcript_length INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS for development (enable and configure for production)
ALTER TABLE articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences DISABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist DISABLE ROW LEVEL SECURITY;
ALTER TABLE earnings_analyses DISABLE ROW LEVEL SECURITY;