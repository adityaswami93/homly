CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT,
  question TEXT,
  difficulty TEXT,
  answer TEXT,
  sources JSONB,
  confidence TEXT,
  iterations INT,
  relevance_score INT,
  groundedness_score INT,
  source_quality_score INT,
  confidence_accuracy_score INT,
  overall_score INT,
  notes TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS needed — eval data is internal, not user-specific
