# Pantry Inventory + Smart Recipe Cross-Reference — Implementation Notes

## Problem

Phase 1 recipe scan returned a raw shopping list with no awareness of what the household already had. Users would receive a list including items like "jasmine rice" or "soy sauce" even if they'd just bought them. There was also no way to track pantry state or update it conversationally.

## Solution

Added a `pantry_items` table scoped by `household_id`. The recipe scan agent now cross-references each ingredient against the pantry before building the shopping list reply. Users manage pantry state via the dashboard or WhatsApp text commands.

### Components

**`backend/migrations/024_pantry.sql`**
New `pantry_items` table with `canonical_name`, `status` (in_stock / low / out_of_stock), category, quantity, unit. Unique constraint on `(household_id, canonical_name)` enables safe upserts.

**`backend/api/routers/pantry.py`**
CRUD endpoints for pantry management. `GET/POST /pantry`, `PATCH/DELETE /pantry/{canonical_name}`, and `GET /internal/pantry` for bot use. URL-decodes the path param so items with spaces work correctly.

**`backend/agents/query/pantry_agent.py`**
`PantryQueryAgent` registered in the router. Handles five intents: `add_item`, `mark_used`, `mark_low`, `list_items`, `check_item`. WhatsApp text commands like "added rice" and "running low on eggs" route here automatically via the existing LLM router.

**`backend/agents/recipe_agent.py` — `analyse_dish_with_pantry()`**
Calls `analyse_dish()` then queries `pantry_items` for each non-staple ingredient using `ilike` fuzzy match. Annotates each ingredient with `pantry_status` and returns summary arrays: `need_to_buy`, `running_low`, `already_have`.

**`backend/api/routers/recipe.py`**
Updated to use `analyse_dish_with_pantry`. Only adds items to `shopping_list` where `pantry_status != 'in_stock'`.

**`backend/whatsapp/index.js` — `processRecipeImage`**
Three reply branches:
1. All ingredients `unknown` (no pantry data yet) → Phase 1 raw list + tip to add pantry items.
2. Everything in stock → "You have everything to make this!"
3. Pantry-aware → "Need to buy" list with running-low items marked, "Already have" section.

**`frontend/app/(shell)/expenses/pantry/page.tsx`**
Dark stone theme pantry management page. Tab pills (All / Running Low / Out of Stock), client-side search, quick-action status buttons (✓ / ~ / ✗), optimistic updates, inline add form. No page refetch on status change — all state managed locally.

## Technical Notes

- Pantry matching uses `ilike` with `%canonical_name%` — partial match is intentional for flexibility (e.g. "chicken" matches "chicken breast").
- `SKIP_AUTH_PATHS` in auth middleware includes `/internal/pantry` so the bot can call it with `X-Internal-Key`.
- The `PantryQueryAgent` upserts with `added_by: 'bot'` so items added via WhatsApp are distinguishable from dashboard additions.
- Frontend uses `encodeURIComponent` on canonical names in PATCH/DELETE URLs to handle spaces and special characters.
