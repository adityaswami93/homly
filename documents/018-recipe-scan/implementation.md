# Recipe Scan — Implementation Notes

## Problem

Homly users photograph food dishes in the WhatsApp group and want the bot to respond with a shopping list of ingredients so they can cook the dish. Previously, every image was routed exclusively to receipt OCR.

## Solution

Added a parallel image-processing path triggered by a caption keyword. When the image caption matches `🛒`, `cook`, `recipe`, `ingredients`, or `what do i need` (case-insensitive), the bot routes to a new recipe scan flow instead of the receipt flow.

### Components

**`backend/agents/recipe_agent.py`**
Calls the same vision LLM used for receipts (`get_vision_completion`). The prompt instructs the model to identify the dish and return a structured ingredient list with quantities, units, categories, and a `pantry_staple` flag.

**`backend/api/routers/recipe.py`**
`POST /recipe/scan` — accepts multipart form with `file`, `group_jid`, and optional sender fields. Resolves `household_id` the same way as `POST /process-receipt` (JWT or service key + group_jid lookup). Non-staple ingredients are upserted into `shopping_list` with `added_by = 'recipe'`.

**`backend/whatsapp/index.js`**
- `isRecipeCaption(caption)` — checks the image caption against trigger patterns.
- `processRecipeImage(msg, sock)` — downloads the image, POSTs to `/recipe/scan`, formats and sends the reply.
- In `messages.upsert`, caption is checked before routing to receipt or recipe handler.

**`backend/migrations/023_recipe_shopping.sql`**
Extends the `shopping_list_added_by_check` constraint to allow the new `'recipe'` value.

## Technical Notes

- The `/expenses/insights` shopping list page shows recipe-added items automatically — no frontend changes needed.
- Upsert conflict key is `household_id, canonical_name` — re-scanning the same dish updates the row without duplication.
- Pantry staples are skipped from the shopping list but listed in the WhatsApp reply for transparency.
- The bot sends a `⚠️` prefix when `confidence` is `low` so users know the dish identification was uncertain.
