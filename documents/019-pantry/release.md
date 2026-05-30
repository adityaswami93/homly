# Pantry Inventory + Smart Recipe Cross-Reference — Release Notes

## Files Changed

| File | Change |
|------|--------|
| `backend/migrations/024_pantry.sql` | New — pantry_items table |
| `backend/api/routers/pantry.py` | New — CRUD + internal endpoints |
| `backend/api/main.py` | Added pantry router |
| `backend/api/middleware/auth.py` | Added `/internal/pantry` to SKIP_AUTH_PATHS |
| `backend/agents/query/pantry_agent.py` | New — PantryQueryAgent |
| `backend/agents/router_agent.py` | Registered PantryQueryAgent |
| `backend/agents/recipe_agent.py` | Added `analyse_dish_with_pantry()` and `_check_pantry()` |
| `backend/api/routers/recipe.py` | Use `analyse_dish_with_pantry`, filter shopping list by pantry status |
| `backend/whatsapp/index.js` | Updated `processRecipeImage` reply with pantry-aware format |
| `frontend/app/(shell)/expenses/pantry/page.tsx` | New — pantry management UI |
| `frontend/config/apps.ts` | Added Pantry nav item to expenses app |
| `documents/019-pantry/implementation.md` | New |
| `documents/019-pantry/release.md` | New (this file) |

## Migration

Run in Supabase SQL editor **before deploying**:

```sql
-- 024_pantry.sql
CREATE TABLE IF NOT EXISTS pantry_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT,
  category TEXT,
  status TEXT DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'low', 'out_of_stock')),
  notes TEXT,
  added_by TEXT DEFAULT 'manual',
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, canonical_name)
);

ALTER TABLE pantry_items DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pantry_household ON pantry_items(household_id);
CREATE INDEX IF NOT EXISTS idx_pantry_canonical ON pantry_items(canonical_name);
```

## WhatsApp Commands

Users can manage pantry via text in the WhatsApp group:
- `"added 2kg rice"` → marks rice as in stock
- `"used up garlic"` → marks garlic as out of stock
- `"running low on eggs"` → marks eggs as low
- `"what's in the pantry?"` → lists all items by status
- `"do we have coconut milk?"` → checks a specific item

## Recipe Scan Behaviour

| Pantry State | Shopping List | WhatsApp Reply |
|---|---|---|
| All unknown (no pantry data) | All non-staples added | Phase 1 raw list + tip to add pantry items |
| All in stock | Nothing added | "You have everything to make this!" |
| Mixed | out_of_stock + low items added | Need to buy / Already have breakdown |

## Known Issues

- Pantry matching uses `ilike` fuzzy match — "chicken breast" and "chicken thigh" may both match a pantry entry for "chicken". Acceptable for v1.
- No quantity tracking — status only (in_stock / low / out_of_stock). Users cannot record "500g of rice remaining".
- Pantry is not automatically depleted when recipes are cooked — manual update only.
- Running-low items are added to the shopping list (intentional) but not shown in "need to buy" section separately on the dashboard; they appear with the regular shopping list items.
