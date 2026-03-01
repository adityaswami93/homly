# 003 — Settings

## Problem
Summary schedule was hardcoded (Friday 6pm SGT). No way to change it without redeploying.

## Solution
Settings stored in Supabase. Settings page in dashboard. Bot polls for changes every 5 minutes and reschedules cron automatically.

## Claude Code prompt
(See session transcript.)

## Technical notes
- `summary_day`: 0=Monday, 6=Sunday
- `summary_hour`: 24hr UTC
- `cutoff_mode`: `last7days` or `isoweek`
- Bot polls `/internal/settings` every 5 min — no restart needed when settings change
- cron-node used for scheduling with timezone support
