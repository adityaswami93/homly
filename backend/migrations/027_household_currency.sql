-- 027_household_currency.sql: default currency per household (supports multi-country households)
ALTER TABLE households ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'SGD';
