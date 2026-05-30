# Task 022 — Fridge/Pantry Scan: Implementation

## Overview

Adds a fridge scan flow to Homly. Users send a photo of their fridge, pantry shelf, or grocery bag with a trigger caption. The vision model identifies items, shows a confirmation list, and adds confirmed items to the pantry.

## Files Changed

### New files
- `backend/agents/fridge_agent.py` — Vision LLM call → structured JSON item list (`scan_fridge`)
- `backend/migrations/026_pantry_fridge_source.sql` — Adds `fridge_scan` to `added_by` constraint

### Modified files
- `backend/agents/homly_graph.py`
  - `classify_node`: caption-based fridge scan detection (before vision model call)
  - `fridge_scan_node`: calls `scan_fridge`, converts items to `pantry_candidates` shape
  - `route_after_fridge_scan`: routes to confirmation if items found, else synthesise
  - `send_pantry_confirmation_node`: distinct header for fridge scan source; ⚠️ badge for low-confidence items
  - `update_pantry_node`: reads `source` field from candidates for `added_by`
  - `synthesise_node`: handles `fridge_scan` agent result with appropriate messages
  - Graph wiring: `fridge_scan` node + conditional edges
- `frontend/app/(shell)/expenses/pantry/page.tsx` — 🧊 badge for `added_by = "fridge_scan"`

## Flow

```
WhatsApp image with caption containing fridge/pantry/shelf/etc.
    ↓
classify_node → "fridge_scan" (caption match, no vision model call)
    ↓
fridge_scan_node → scan_fridge() → pantry_candidates
    ↓
route_after_fridge_scan
  ├─ pantry_candidates empty → synthesise ("Could not identify...")
  └─ pantry_candidates populated → send_pantry_confirmation
         ↓ (interrupt, wait for reply)
     resume_from_confirmation → update_pantry → confirm_to_user → synthesise
```

## Trigger Keywords

Caption must contain one of (case-insensitive):
`fridge`, `pantry`, `shelf`, `stock`, `groceries`, `what do we have`, `what's in`, `inventory`, `cupboard`

## Schema

`fridge_agent.scan_fridge` returns:
```json
{
  "items": [{"canonical_name": "...", "quantity": 1, "unit": "...", "category": "...", "confidence": "high|medium|low"}],
  "scan_confidence": "high|medium|low",
  "notes": "..."
}
```

Items are converted to `pantry_candidates` with `source: "fridge_scan"`, which `update_pantry_node` uses as `added_by`.
