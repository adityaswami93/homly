# Phase 3 — Pantry Receipt Confirmation: Release Notes

## What's new

When a grocery receipt is processed by the WhatsApp bot, members now receive a confirmation prompt before any pantry items are added:

```
🛒 *Grocery receipt saved* — FairPrice, SGD 47.80

Add these items to your pantry?

1. Jasmine Rice (5 kg)
2. Eggs (10)
3. Broccoli
4. Chicken Breast
5. Coconut Milk (400 ml)

Reply *yes* to add all, *no* to skip, or list numbers to add specific items (e.g. *1,3,5*)
```

Accepted replies:
- `yes` / `y` / `ok` / `yeah` / `sure` → add all items
- `no` / `n` / `nope` / `skip` → add nothing
- `1,3,5` → add items 1, 3, and 5 only
- `rice, eggs` → fuzzy-match against item names
- Anything else → treated as "yes" (bias toward adding)

The pantry dashboard now shows a 🧾 badge on items added from receipts and a 🍽️ badge on items added from recipe photos.

## Migration required

Run `025_pantry_receipt_source.sql` in the Supabase SQL editor before deploying.

## Known limitations

- **Confirmation expires never**: if a household member sends a receipt and no one ever replies, the graph stays paused indefinitely in the checkpointer. This is intentional for v1 — the next receipt from the same group resumes that thread. Members can reply `no` at any time to close the pending prompt.
- **Thread is per group JID, not per user**: simultaneous receipts from two people in the same group may interleave confirmations. Low probability in a household context.
- **OCR name quality**: item names extracted from receipts may differ from existing pantry entries, creating duplicates (e.g. "jasmine rice 5kg" vs "jasmine rice"). Users can clean duplicates from the pantry dashboard. Future work can add fuzzy dedup at upsert time.
- **Non-grocery receipts**: restaurant and transport receipts are never sent to pantry. Only receipts classified as grocery trigger the confirmation flow.
- **No auto-pantry on receipt anymore**: prior to this phase, all receipt items were silently added to the pantry. This is now gated behind the confirmation prompt. Existing pantry data is unchanged.
