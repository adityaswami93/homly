-- 037_super_admin_app_metadata.sql
--
-- Move the super-admin flag out of a user-writable claim.
--
-- `006_multi_tenant.sql` provisioned super admins with:
--     UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"is_super_admin": true}'
-- and api/middleware/auth.py read it back from the JWT's `user_metadata` claim.
--
-- `raw_user_meta_data` is exactly the field Supabase lets any authenticated
-- user write to themselves, with nothing but the anon key:
--     supabase.auth.updateUser({ data: { is_super_admin: true } })
-- The next token refresh then carries `user_metadata.is_super_admin = true`,
-- and `require_super_admin()` (api/routers/households.py) let that through —
-- granting /admin/households, /admin/invites and /admin/price-intelligence,
-- all of which query with the service-role client and no household filter.
-- Any registered user could read every household's data.
--
-- `raw_app_meta_data` is the admin-only counterpart: it is writable only
-- through the Admin API (service-role key) or SQL, never by the user whose
-- row it is. It surfaces in the JWT as the `app_metadata` claim.
--
-- This migration copies the flag across for existing super admins and strips
-- it from `raw_user_meta_data`, so a value a user may already have set for
-- themselves stops being readable as an grant anywhere.

-- 1. Promote genuine existing super admins (set by an operator via SQL on the
--    server, per 006) into app_metadata.
--
--    NOTE: this cannot distinguish an operator-granted flag from one a user
--    set on themselves — that ambiguity is the vulnerability. Review the
--    output of this SELECT before running the migration, and cut the list
--    down by email if anyone unexpected appears:
--
--      SELECT email, raw_user_meta_data->>'is_super_admin'
--      FROM auth.users
--      WHERE raw_user_meta_data->>'is_super_admin' = 'true';

UPDATE auth.users
SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"is_super_admin": true}'::jsonb
WHERE raw_user_meta_data->>'is_super_admin' = 'true';

-- 2. Strip the flag from the user-writable side for everyone, so it can never
--    be mistaken for a grant again (including rows where a user had set it
--    themselves and step 1 deliberately did not promote).
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data - 'is_super_admin'
WHERE raw_user_meta_data ? 'is_super_admin';

-- Granting super admin from here on (operator, via SQL or the Admin API):
--   UPDATE auth.users
--   SET raw_app_meta_data =
--         COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"is_super_admin": true}'::jsonb
--   WHERE email = 'your@email.com';
--
-- Revoking:
--   UPDATE auth.users
--   SET raw_app_meta_data = raw_app_meta_data - 'is_super_admin'
--   WHERE email = 'their@email.com';
--
-- Either takes effect on that user's next token refresh, not instantly.
