# Task 022 — Fridge/Pantry Scan: Release Notes

## What's New

Send a photo of your fridge, pantry shelf, or grocery bag to the Homly WhatsApp group with a trigger caption. Homly will identify every visible food item and ask you to confirm before adding them to your pantry.

**Trigger captions** (any of these words in your caption):
`fridge`, `pantry`, `shelf`, `stock`, `groceries`, `what do we have`, `what's in`, `inventory`, `cupboard`

Example: send a fridge photo captioned "fridge check" or just "pantry".

## Confirmation Flow

After scanning, Homly sends a numbered list of detected items. Low-confidence items are marked ⚠️. Reply:
- **yes** — add all items
- **no** — skip
- **1,3,5** — add specific items by number

## Dashboard

Items added via fridge scan show a 🧊 badge in the pantry page, alongside the existing 🧾 (receipt) and 🍽️ (recipe) badges.

## Known Limitations

- Cannot detect items behind other items or in closed drawers
- Quantity estimates are approximate — the vision model counts what it can see
- Brand names are normalised to product type: "Meiji milk" becomes "milk", "Tropicana" becomes "orange juice"
- A cluttered or dark fridge photo will produce low-confidence results across the board — try again with better lighting and a straight-on angle

## Migration Required

Run `026_pantry_fridge_source.sql` in Supabase before deploying. This extends the `added_by` constraint to include `fridge_scan`.
