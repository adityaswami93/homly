import { createClient } from '@supabase/supabase-js'

// Session is kept alive for 30 days via auto token refresh.
// The Supabase project must also have JWT expiry ≥ 2592000 s (30 days)
// configured under Authentication → Settings → JWT expiry.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'homly-auth',
    },
  }
)