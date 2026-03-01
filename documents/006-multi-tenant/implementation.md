# 006 — Multi-tenant Refactor

## Problem
App is single-tenant. One user, one household, hardcoded everywhere.
Cannot onboard other households without separate deployments.

## Solution
- households table — one per paying customer
- household_members — links users to households with admin/member roles
- All data filtered by household_id instead of user_id
- One shared WhatsApp bot monitors all groups
- Super admin panel to invite users and manage households
- Onboarding flow for new users

## Technical notes
- Migration backfills household_id on all existing data
- Super admin flag stored in Supabase user_metadata
- Invite flow: super admin sends invite → user signs up → accept-invite endpoint links them to household
- Bot uses HOMLY_USER_ID to look up household_id via household_members table
- Member roles: admin (full access), member (read only)
