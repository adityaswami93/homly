# Recipe Scan — Release Notes

## Files Changed

| File | Change |
|------|--------|
| `backend/agents/recipe_agent.py` | New — vision LLM agent for dish identification |
| `backend/api/routers/recipe.py` | New — `POST /recipe/scan` endpoint |
| `backend/api/main.py` | Added `recipe` router import and `app.include_router` |
| `backend/whatsapp/index.js` | Added `isRecipeCaption`, `processRecipeImage`, caption routing in `messages.upsert` |
| `backend/migrations/023_recipe_shopping.sql` | New — extends `added_by` constraint |
| `documents/018-recipe-scan/implementation.md` | New — technical documentation |
| `documents/018-recipe-scan/release.md` | New — this file |

## Migration

Run in Supabase SQL editor:

```sql
-- 023_recipe_shopping.sql
ALTER TABLE shopping_list DROP CONSTRAINT IF EXISTS shopping_list_added_by_check;
ALTER TABLE shopping_list ADD CONSTRAINT shopping_list_added_by_check
  CHECK (added_by IN ('auto', 'manual', 'recipe'));
```

## Trigger Keywords

Send an image to the WhatsApp group with any of these captions to activate recipe scan:
- `🛒`
- `cook`
- `recipe`
- `ingredients`
- `what do i need` / `what do I need`

No caption or any other caption routes to the existing receipt OCR flow.

## Known Issues

- The vision model may misidentify dishes with low lighting or obstructed views; the bot signals this with a `⚠️` prefix.
- Ingredient quantities are estimates for 4 servings; no per-household serving adjustment is implemented.
- The `serves` field is returned in the API response but not displayed in the WhatsApp reply.
