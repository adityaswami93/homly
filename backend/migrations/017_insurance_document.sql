-- Migration: 017_insurance_document.sql
-- Adds AI-extracted document storage fields to insurance_policies.
-- Run manually in Supabase SQL editor.
--
-- Also requires manual Supabase Dashboard steps:
--   1. Create Storage bucket named 'insurance-documents' (Private)
--   2. Add RLS policy so household members can read their own docs

ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS document_path TEXT;

ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS document_summary TEXT;

-- Structured coverage data extracted by AI from the policy document.
-- Shape: { covered: [], exclusions: [], limits: {}, waiting_period, deductible, beneficiaries[] }
ALTER TABLE insurance_policies
  ADD COLUMN IF NOT EXISTS coverage_details JSONB;

-- GIN index for future coverage_details queries
CREATE INDEX IF NOT EXISTS insurance_policies_coverage_details_gin
  ON insurance_policies USING GIN (coverage_details)
  WHERE coverage_details IS NOT NULL;
